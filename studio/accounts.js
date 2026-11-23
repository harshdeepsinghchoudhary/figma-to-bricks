import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback),hash=v=>createHash('sha256').update(v).digest('hex');
export function accounts(file){
 const db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);');
 return {
  async register(email,password){
   email=String(email||'').trim().toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length<12||password.length>256)throw Error('Use a valid email and a password of 12–256 characters.');
   if(db.prepare('SELECT count(*) AS n FROM users').get().n>=50)throw Error('Private beta account capacity reached.');
   const salt=randomBytes(16).toString('hex'),digest=(await scrypt(password,salt,64)).toString('hex'),id=randomUUID();
   try{db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id,email,salt,digest)}catch{throw Error('Could not create account. Try signing in.');}
   return {id,email};
  },
  async login(email,password){
   if(typeof password!=='string'||password.length>256)throw Error('Invalid email or password.');
   const user=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').trim().toLowerCase());
   const candidate=await scrypt(password,user?.salt||'invalid-account',64);
   if(!user||!timingSafeEqual(candidate,Buffer.from(user.password,'hex')))throw Error('Invalid email or password.');
   return {id:user.id,email:user.email};
  },
  session(user){const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),user.id,Date.now()+12*3600000);return token;},
  user(token){if(!token)return null;return db.prepare('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND expires>?').get(hash(token),Date.now())||null;},
  logout(token){db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token||''));},
  close(){db.close();},
 };
}
