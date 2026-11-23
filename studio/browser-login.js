import {chromium} from 'playwright-core';
import {findBrowser} from '../scripts/preview.js';
import {saveVault} from './vault.js';

// The user operates security challenges; Studio never attempts to solve them.
export function createBrowserLogin(file,key,env){
 let browser,context,origin;
 return {
  async open(){
   if(env().STUDIO_HOSTED==='1')throw Error('Interactive browser connection is currently local-only.');
   const target=new URL(env().WP_API_URL);if(!['https:','http:'].includes(target.protocol))throw Error('Configure your WordPress site first.');
   await browser?.close();origin=target.origin;
   browser=await chromium.launch({executablePath:findBrowser(),headless:false});context=await browser.newContext();
   const page=await context.newPage();await page.goto(new URL('/wp-login.php',origin).href,{waitUntil:'domcontentloaded'});
   return {message:'In the opened browser, complete the website check and sign in yourself. Then click Use this browser session.'};
  },
  async finish(){
   if(!context||new URL(env().WP_API_URL).origin!==origin)throw Error('Open the browser connection for the configured site first.');
   if(!(await context.cookies(origin)).some(c=>c.name.startsWith('wordpress_logged_in_')))throw Error('Sign in to WordPress in the opened browser first.');
   const state=await context.storageState();
   saveVault(file,{origin,state:{cookies:state.cookies.filter(c=>{const d=c.domain.replace(/^\./,'');return new URL(origin).hostname===d||new URL(origin).hostname.endsWith('.'+d)}),origins:state.origins.filter(o=>o.origin===origin)}},key);
   await browser.close();browser=null;context=null;
   return {message:'Browser session connected for this Studio session. Retry the existing conversion.'};
  },
  async close(){await browser?.close();}
 };
}
