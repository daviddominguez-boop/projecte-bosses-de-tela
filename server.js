const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true, app: 'Projecte Bosses de Tela' }));
const rooms = new Map();
const AVATARS = ['🐼','🦊','🐸','🐯','🦁','🐨','🐵','🐰','🐻','🐶','🐱','🦄','🐧','🦉','🐢','🐬','🦋','🐙','🦖','🐝','🐮','🐷','🐹','🐻‍❄️','🦓','🦒','🐘','🦜','🦩','🦔'];
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const safeName = v => String(v || '').trim().replace(/[<>]/g, '').slice(0, 24);
function makeCode(){ let c; do { c=''; for(let i=0;i<6;i++) c+=alphabet[Math.floor(Math.random()*alphabet.length)]; } while(rooms.has(c)); return c; }
function players(room){ return [...room.players.values()].sort((a,b)=>b.score-a.score).map(p=>({id:p.id,name:p.name,avatar:p.avatar,score:p.score,answered:p.answered,correct:p.correct,wrong:p.wrong})); }
function stats(room){ let correct=0,wrong=0; for(const p of room.players.values()){correct+=p.correct;wrong+=p.wrong;} const total=correct+wrong; return {correct,wrong,total,correctPct:total?Math.round(correct/total*100):0,wrongPct:total?Math.round(wrong/total*100):0}; }
function broadcast(room){io.to(room.code).emit('room:update',{code:room.code,title:room.title,status:room.status,index:room.index,total:room.questions.length,seconds:room.seconds,players:players(room),stats:stats(room)});}
function podium(room){return players(room).slice(0,3);}
function endQuestion(room){
 if(room.timer)clearTimeout(room.timer); room.timer=null; if(room.status!=='question')return;
 room.status='reveal'; broadcast(room);
 io.to(room.hostId).emit('host:question-reveal',{index:room.index,total:room.questions.length,players:players(room),stats:stats(room),hasNext:room.index+1<room.questions.length});
 const sorted=players(room);
 for(const p of room.players.values()){
   const position=sorted.findIndex(x=>x.id===p.id)+1;
   const leader=position>1?sorted[position-2]:null;
   const gap=leader?Math.max(0,leader.score-p.score):0;
   const result=p.lastAnswer||{answered:false,correct:null};
   io.to(p.id).emit('player:question-result',{index:room.index,total:room.questions.length,answered:result.answered,correct:result.correct,position,totalPlayers:sorted.length,score:p.score,onPodium:position<=3,behind:leader?leader.name:null,gap});
 }
}
function finishGame(room){if(room.timer)clearTimeout(room.timer);room.timer=null;room.status='finished';broadcast(room);io.to(room.code).emit('game:finished',{players:players(room),stats:stats(room)});}
function startQuestion(room,index){if(room.timer)clearTimeout(room.timer);room.index=index;room.status='question';room.started=Date.now();for(const p of room.players.values()){p.answered=false;p.lastAnswer=null;}const q=room.questions[index];io.to(room.code).emit('question:start',{index,total:room.questions.length,q:q.q,answers:q.a,seconds:room.seconds,endsAt:Date.now()+room.seconds*1000});broadcast(room);room.timer=setTimeout(()=>endQuestion(room),room.seconds*1000);}
io.on('connection',socket=>{
 socket.on('room:create',(data,cb)=>{try{if(!data||!Array.isArray(data.questions)||!data.questions.length)throw Error('Falten preguntes.');const questions=data.questions.map(q=>{if(!q.q||!Array.isArray(q.a)||q.a.length!==4||!Number.isInteger(q.correct)||q.correct<0||q.correct>3)throw Error('Hi ha una pregunta incompleta.');return {q:String(q.q).slice(0,500),a:q.a.map(String),correct:q.correct};});const code=makeCode();const room={code,title:String(data.title||'Projecte Bosses de Tela').slice(0,100),hostId:socket.id,players:new Map(),questions,seconds:Math.min(60,Math.max(5,Number(data.seconds)||15)),status:'lobby',index:-1,timer:null};rooms.set(code,room);socket.data.roomCode=code;socket.data.role='host';socket.join(code);cb({ok:true,code,title:room.title,players:[],status:'lobby',total:questions.length,stats:stats(room)});}catch(e){cb({ok:false,error:e.message||'No s’ha pogut crear la sala.'});}});
 socket.on('room:join',(data,cb)=>{const code=String(data.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');const room=rooms.get(code);if(!room)return cb({ok:false,error:'No existeix la sala. Revisa el codi.'});if(room.status!=='lobby')return cb({ok:false,error:'La partida ja ha començat.'});const name=safeName(data.name);if(!name)return cb({ok:false,error:'Escriu el teu nom.'});if([...room.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return cb({ok:false,error:'Aquest nom ja està en la sala.'});room.players.set(socket.id,{id:socket.id,name,avatar:AVATARS.includes(data.avatar)?data.avatar:AVATARS[0],score:0,answered:false,lastAnswer:null,correct:0,wrong:0});socket.data.roomCode=code;socket.data.role='player';socket.join(code);cb({ok:true,code});broadcast(room);});
 socket.on('game:start',(_,cb)=>{const room=rooms.get(socket.data.roomCode);if(!room||room.hostId!==socket.id)return cb&&cb({ok:false,error:'Només l’amfitrió pot començar.'});if(!room.players.size)return cb&&cb({ok:false,error:'Espera que entre almenys un company.'});if(room.status!=='lobby')return cb&&cb({ok:false,error:'La partida ja està en marxa.'});startQuestion(room,0);if(cb)cb({ok:true});});
 socket.on('answer:submit',(data,cb)=>{const room=rooms.get(socket.data.roomCode);const p=room&&room.players.get(socket.id);if(!room||!p||room.status!=='question')return cb&&cb({ok:false,error:'Ara no s’accepten respostes.'});if(p.answered)return cb&&cb({ok:false,error:'Ja has respost.'});const choice=Number(data.choice),q=room.questions[room.index];if(!Number.isInteger(choice)||choice<0||choice>3)return cb&&cb({ok:false,error:'Resposta no vàlida.'});p.answered=true;const correct=choice===q.correct;if(correct){p.correct++;const elapsed=Date.now()-room.started;const speed=Math.max(0,1-elapsed/(room.seconds*1000));p.score+=500+Math.round(speed*500);}else{p.wrong++;p.score=Math.max(0,p.score-100);}p.lastAnswer={answered:true,correct};cb&&cb({ok:true,message:'Resposta enviada. Espera que s’acabe el temps.'});broadcast(room);});
 socket.on('game:next',(_,cb)=>{const room=rooms.get(socket.data.roomCode);if(!room||room.hostId!==socket.id)return cb&&cb({ok:false,error:'Només l’amfitrió pot avançar.'});if(room.status!=='reveal')return cb&&cb({ok:false,error:'Espera que acabe la pregunta.'});if(room.index+1>=room.questions.length){finishGame(room);return cb&&cb({ok:true,finished:true});}startQuestion(room,room.index+1);if(cb)cb({ok:true});});
 socket.on('room:kick',(data,cb)=>{const room=rooms.get(socket.data.roomCode);if(!room||room.hostId!==socket.id)return cb&&cb({ok:false,error:'Només l’amfitrió pot expulsar participants.'});if(room.status!=='lobby')return cb&&cb({ok:false,error:'Només pots expulsar abans de començar la partida.'});const id=String(data&&data.id||'');const p=room.players.get(id);if(!p)return cb&&cb({ok:false,error:'Aquest participant ja no està en la sala.'});room.players.delete(id);const target=io.sockets.sockets.get(id);if(target){target.emit('player:kicked');target.leave(room.code);target.data.roomCode=null;target.data.role=null;}broadcast(room);if(cb)cb({ok:true});});
 socket.on('disconnect',()=>{const code=socket.data.roomCode;const room=rooms.get(code);if(!room)return;if(room.hostId===socket.id){if(room.timer)clearTimeout(room.timer);io.to(code).emit('room:closed');rooms.delete(code);}else{room.players.delete(socket.id);broadcast(room);}});
});
server.listen(PORT,()=>console.log(`Projecte Bosses de Tela listening on ${PORT}`));
