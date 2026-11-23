import 'dotenv/config';
import path from 'node:path';
import {capture} from '../studio/visual.js';
try {
 const origin=new URL(process.env.WP_API_URL).origin;
 await capture([],process.cwd(),path.resolve(process.argv[2]),[1024],new URL('/wp-admin/',origin).href,origin,{requireAuthentication:true,accessOnly:true});
 console.log('WordPress browser authentication verified.');
}catch(error){console.error(error.message);process.exitCode=1;}
