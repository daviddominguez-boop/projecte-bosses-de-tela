const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_,res)=>res.json({ok:true, app:"QuizKahoot"}));

const rooms = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function code(){let c; do {c=""; for(let i=0;i<6;i++) c+=alphabet[Math.floor(Math.random()*alphabet.length)];} while(rooms.has(c)); return c;}
function publicRoom(r){return {code:r.code,title:r.quiz.title,hostName:r.hostName,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,answered:p.answered})),status:r.status,questionIndex:r.questionIndex,total:r.quiz.questions.length};}
function broadcast(room){io.to(room.code).emit("room:update",publicRoom(room));}
function safeQuiz(q){
 if(!q || typeof q.title!=="string" || !Array.isArray(q.questions) || q.questions.length<1 || q.questions.length>50) throw Error("El cuestionario debe tener entre 1 y 50 preguntas.");
 const questions=q.questions.map((x,i)=>{
  if(!x.q || !Array.isArray(x.a) || x.a.length!==4 || x.a.some(a=>!String(a).trim()) || !Number.isInteger(x.correct) || x.correct<0 || x.correct>3) throw Error(`Revisa la pregunta ${i+1}: necesita texto, cuatro respuestas y una correcta.`);
  return {q:String(x.q).slice(0,500),a:x.a.map(a=>String(a).slice(0,200)),correct:x.correct};
 });
 return {title:q.title.slice(0,100),seconds:Math.min(60,Math.max(5,Number(q.seconds)||15)),questions};
}
function roomFor(socket){return socket.data.roomCode && rooms.get(socket.data.roomCode);}
function endQuestion(room){
 if(room.timer) clearTimeout(room.timer);
 room.status="reveal";
 const q=room.quiz.questions[room.questionIndex];
 io.to(room.code).emit("question:result",{correct:q.correct,answer:q.a[q.correct],scores:[...room.players.values()].map(p=>({name:p.name,score:p.score,earned:p.lastEarned||0}))});
 broadcast(room);
 room.timer=setTimeout(()=>{
  if(!rooms.has(room.code)) return;
  if(room.questionIndex+1>=room.quiz.questions.length){room.status="finished";broadcast(room);io.to(room.code).emit("game:finished",{leaderboard:[...room.players.values()].sort((a,b)=>b.score-a.score).map(p=>({name:p.name,score:p.score}))});}
  else {room.questionIndex++;startQuestion(room);}
 },5000);
}
function startQuestion(room){
 if(room.timer) clearTimeout(room.timer);
 room.status="question"; room.questionStarted=Date.now();
 for(const p of room.players.values()){p.answered=false;p.lastEarned=0;}
 const q=room.quiz.questions[room.questionIndex];
 io.to(room.code).emit("question:start",{index:room.questionIndex,total:room.quiz.questions.length,q:q.q,answers:q.a,seconds:room.quiz.seconds,endsAt:Date.now()+room.quiz.seconds*1000});
 broadcast(room);
 room.timer=setTimeout(()=>{if(room.status==="question")endQuestion(room);},room.quiz.seconds*1000);
}
io.on("connection",socket=>{
 socket.on("room:create",(data,cb)=>{
  try{
   const quiz=safeQuiz(data.quiz),name=String(data.name||"Anfitrión").trim().slice(0,24)||"Anfitrión",c=code();
   const room={code:c,quiz,hostId:socket.id,hostName:name,players:new Map(),status:"lobby",questionIndex:-1,timer:null};
   room.players.set(socket.id,{id:socket.id,name,score:0,answered:false,isHost:true,lastEarned:0});
   rooms.set(c,room);socket.data.roomCode=c;socket.data.isHost=true;socket.join(c);
   cb({ok:true,room:publicRoom(room),role:"host"});
  }catch(e){cb({ok:false,error:e.message||"No se pudo crear la sala."});}
 });
 socket.on("room:join",(data,cb)=>{
  const c=String(data.code||"").toUpperCase().replace(/[^A-Z0-9]/g,""),room=rooms.get(c);
  if(!room)return cb({ok:false,error:"No existe esa sala. Revisa el código."});
  if(room.status!=="lobby")return cb({ok:false,error:"La partida ya ha empezado."});
  const name=String(data.name||"").trim().slice(0,24);
  if(!name)return cb({ok:false,error:"Escribe un nombre."});
  if([...room.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return cb({ok:false,error:"Ese nombre ya está en la sala."});
  room.players.set(socket.id,{id:socket.id,name,score:0,answered:false,isHost:false,lastEarned:0});
  socket.data.roomCode=c;socket.data.isHost=false;socket.join(c);
  cb({ok:true,room:publicRoom(room),role:"player"});broadcast(room);
 });
 socket.on("game:start",(_,cb)=>{
  const room=roomFor(socket);if(!room||room.hostId!==socket.id)return cb&&cb({ok:false,error:"Solo el anfitrión puede iniciar."});
  if(room.status!=="lobby")return cb&&cb({ok:false,error:"La partida ya está en marcha."});
  if(room.players.size<1)return cb&&cb({ok:false,error:"No hay jugadores."});
  room.questionIndex=0;startQuestion(room);if(cb)cb({ok:true});
 });
 socket.on("answer:submit",(data,cb)=>{
  const room=roomFor(socket),p=room&&room.players.get(socket.id);
  if(!room||!p||room.status!=="question")return cb&&cb({ok:false,error:"No se aceptan respuestas ahora."});
  if(p.answered)return cb&&cb({ok:false,error:"Ya has respondido."});
  const choice=Number(data.choice),q=room.quiz.questions[room.questionIndex];
  if(!Number.isInteger(choice)||choice<0||choice>3)return cb&&cb({ok:false,error:"Respuesta no válida."});
  p.answered=true;
  if(choice===q.correct){const elapsed=Date.now()-room.questionStarted;const ratio=Math.max(0,1-elapsed/(room.quiz.seconds*1000));p.lastEarned=500+Math.round(ratio*1000);p.score+=p.lastEarned;}
  socket.emit("answer:accepted",{correct:choice===q.correct});
  broadcast(room);
  if([...room.players.values()].every(x=>x.answered))endQuestion(room);
  if(cb)cb({ok:true});
 });
 socket.on("game:next",(_,cb)=>{
  const room=roomFor(socket);if(!room||room.hostId!==socket.id)return cb&&cb({ok:false,error:"Solo el anfitrión puede avanzar."});
  if(room.status!=="reveal")return cb&&cb({ok:false,error:"Aún no se pueden ver resultados."});
  if(room.timer)clearTimeout(room.timer);
  if(room.questionIndex+1>=room.quiz.questions.length){room.status="finished";broadcast(room);io.to(room.code).emit("game:finished",{leaderboard:[...room.players.values()].sort((a,b)=>b.score-a.score).map(p=>({name:p.name,score:p.score}))});}
  else {room.questionIndex++;startQuestion(room);}
  if(cb)cb({ok:true});
 });
 socket.on("disconnect",()=>{
  const room=roomFor(socket);if(!room)return;
  room.players.delete(socket.id);
  if(room.hostId===socket.id){
   if(room.timer)clearTimeout(room.timer);
   io.to(room.code).emit("room:closed");rooms.delete(room.code);
  } else broadcast(room);
 });
});
server.listen(PORT,()=>console.log(`QuizKahoot listening on ${PORT}`));
