const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
// Fallback for repositories uploaded with index.html at the root.
app.use(express.static(__dirname));
app.get('/health', (_, res) => res.json({ ok: true, app: 'Projecte Bosses de Tela' }));

const rooms = new Map();
const AVATARS = new Set(['🐼','🦊','🐸','🐯','🦁','🐨','🐵','🐰','🐻','🐶','🐱','🦄','🐧','🦉','🐢','🐬','🦋','🐙','🦖','🐝']);
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() { let c; do { c=''; for(let i=0;i<6;i++) c += alphabet[Math.floor(Math.random()*alphabet.length)]; } while(rooms.has(c)); return c; }
function safeName(value, fallback='Jugador') { return String(value || '').trim().replace(/[<>]/g, '').slice(0,24) || fallback; }
function safeAvatar(value) { return AVATARS.has(value) ? value : '🐼'; }
function publicRoom(r) { return { code:r.code, title:r.quiz.title, hostName:r.hostName, players:[...r.players.values()].map(p=>({id:p.id,name:p.name,avatar:p.avatar,score:p.score,answered:p.answered,isHost:p.isHost})), status:r.status, questionIndex:r.questionIndex, total:r.quiz.questions.length }; }
function broadcast(r) { io.to(r.code).emit('room:update', publicRoom(r)); }
function safeQuiz(q) {
 if(!q || typeof q.title!=='string' || !Array.isArray(q.questions) || q.questions.length<1 || q.questions.length>50) throw Error('El qüestionari ha de tindre entre 1 i 50 preguntes.');
 const questions=q.questions.map((x,i)=>{ if(!x.q || !Array.isArray(x.a) || x.a.length!==4 || x.a.some(a=>!String(a).trim()) || !Number.isInteger(x.correct) || x.correct<0 || x.correct>3) throw Error(`Revisa la pregunta ${i+1}: necessita text, quatre respostes i una correcta.`); return {q:String(x.q).slice(0,500),a:x.a.map(a=>String(a).slice(0,200)),correct:x.correct}; });
 return {title:q.title.slice(0,100),seconds:Math.min(60,Math.max(5,Number(q.seconds)||15)),questions};
}
function roomFor(socket) { return socket.data.roomCode && rooms.get(socket.data.roomCode); }
function leaderboard(room) { return [...room.players.values()].sort((a,b)=>b.score-a.score).map(p=>({name:p.name,avatar:p.avatar,score:p.score,isHost:p.isHost})); }
function finishGame(room) { if(room.timer) clearTimeout(room.timer); room.timer=null; room.status='finished'; broadcast(room); io.to(room.code).emit('game:finished',{leaderboard:leaderboard(room)}); }
function endQuestion(room) {
 if(room.timer) clearTimeout(room.timer); room.timer=null; if(room.status!=='question') return;
 room.status='reveal'; const q=room.quiz.questions[room.questionIndex];
 io.to(room.code).emit('question:result',{correct:q.correct,answer:q.a[q.correct],scores:[...room.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,earned:p.lastEarned||0}))}); broadcast(room);
 room.timer=setTimeout(()=>{ if(!rooms.has(room.code)||room.status!=='reveal') return; if(room.questionIndex+1>=room.quiz.questions.length) finishGame(room); else {room.questionIndex++;startQuestion(room);} },5000);
}
function startQuestion(room) {
 if(room.timer) clearTimeout(room.timer); room.status='question'; room.questionStarted=Date.now();
 for(const p of room.players.values()){p.answered=false;p.lastEarned=0;}
 const q=room.quiz.questions[room.questionIndex];
 io.to(room.code).emit('question:start',{index:room.questionIndex,total:room.quiz.questions.length,q:q.q,answers:q.a,seconds:room.quiz.seconds,endsAt:Date.now()+room.quiz.seconds*1000}); broadcast(room);
 room.timer=setTimeout(()=>{if(room.status==='question')endQuestion(room);},room.quiz.seconds*1000);
}
io.on('connection', socket => {
 socket.on('room:create',(data,cb)=>{ try { const quiz=safeQuiz(data.quiz),name=safeName(data.name,'Amfitrió'),avatar=safeAvatar(data.avatar),c=makeCode(); const room={code:c,quiz,hostId:socket.id,hostName:name,players:new Map(),status:'lobby',questionIndex:-1,timer:null}; room.players.set(socket.id,{id:socket.id,name,avatar,score:0,answered:false,isHost:true,lastEarned:0}); rooms.set(c,room);socket.data.roomCode=c;socket.data.isHost=true;socket.join(c);cb({ok:true,room:publicRoom(room),role:'host'}); } catch(e){cb({ok:false,error:e.message||'No s’ha pogut crear la sala.'});} });
 socket.on('room:join',(data,cb)=>{ const c=String(data.code||'').toUpperCase().replace(/[^A-Z0-9]/g,''),room=rooms.get(c); if(!room)return cb({ok:false,error:'No existeix eixa sala. Revisa el codi.'}); if(room.status!=='lobby')return cb({ok:false,error:'La partida ja ha començat.'}); const name=safeName(data.name,''); if(!name)return cb({ok:false,error:'Escriu un nom.'}); if([...room.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return cb({ok:false,error:'Eixe nom ja està en la sala.'}); if(room.players.size>=100)return cb({ok:false,error:'La sala està plena.'}); room.players.set(socket.id,{id:socket.id,name,avatar:safeAvatar(data.avatar),score:0,answered:false,isHost:false,lastEarned:0}); socket.data.roomCode=c;socket.data.isHost=false;socket.join(c);cb({ok:true,room:publicRoom(room),role:'player'});broadcast(room); });
 socket.on('game:start',(_,cb)=>{const room=roomFor(socket);if(!room||room.hostId!==socket.id)return cb&&cb({ok:false,error:'Només qui ha creat la sala pot començar.'});if(room.status!=='lobby')return cb&&cb({ok:false,error:'La partida ja està en marxa.'});room.questionIndex=0;startQuestion(room);if(cb)cb({ok:true});});
 socket.on('answer:submit',(data,cb)=>{const room=roomFor(socket),p=room&&room.players.get(socket.id);if(!room||!p||p.isHost||room.status!=='question')return cb&&cb({ok:false,error:'Ara no s’accepten respostes.'});if(p.answered)return cb&&cb({ok:false,error:'Ja has respost.'});const choice=Number(data.choice),q=room.quiz.questions[room.questionIndex];if(!Number.isInteger(choice)||choice<0||choice>3)return cb&&cb({ok:false,error:'Resposta no vàlida.'});p.answered=true;if(choice===q.correct){const elapsed=Date.now()-room.questionStarted,ratio=Math.max(0,1-elapsed/(room.quiz.seconds*1000));p.lastEarned=500+Math.round(ratio*1000);p.score+=p.lastEarned;}socket.emit('answer:accepted',{correct:choice===q.correct});broadcast(room);const eligible=[...room.players.values()].filter(x=>!x.isHost);if(eligible.length&&eligible.every(x=>x.answered))endQuestion(room);if(cb)cb({ok:true});});
 socket.on('game:next',(_,cb)=>{const room=roomFor(socket);if(!room||room.hostId!==socket.id)return cb&&cb({ok:false,error:'Només qui ha creat la sala pot avançar.'});if(room.status!=='reveal')return cb&&cb({ok:false,error:'Encara no es poden veure els resultats.'});if(room.timer)clearTimeout(room.timer);if(room.questionIndex+1>=room.quiz.questions.length)finishGame(room);else{room.questionIndex++;startQuestion(room);}if(cb)cb({ok:true});});
 socket.on('disconnect',()=>{const room=roomFor(socket);if(!room)return;room.players.delete(socket.id);if(room.hostId===socket.id){if(room.timer)clearTimeout(room.timer);io.to(room.code).emit('room:closed');rooms.delete(room.code);}else broadcast(room);});
});
server.listen(PORT,()=>console.log(`Projecte Bosses de Tela listening on ${PORT}`));
