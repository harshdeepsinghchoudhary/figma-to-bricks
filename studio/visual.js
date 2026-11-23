import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {unlockVault} from './vault.js';
import {chromium} from 'playwright-core';
import {findBrowser,previewHTML} from '../scripts/preview.js';

export function matchesRenderedFont(requested,rendered){
 const normalize=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 const family=normalize(requested),actual=normalize(rendered);
 if(actual===family)return true;
 // Static font files often expose the weight/style in their platform family
 // name. Only accept a known suffix, not arbitrary prefix matches.
 return actual.startsWith(family)&&/^(?:(?:thin|extralight|ultralight|light|regular|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy)(?:italic|oblique)?|italic|oblique)$/.test(actual.slice(family.length));
}

export function allowedPreviewResource(url,type,origin){
 const u=new URL(url);
 if(['data:','about:','blob:'].includes(u.protocol)||origin&&u.origin===origin)return true;
 // Public font endpoints only; never grant external documents/scripts access.
 return u.protocol==='https:' && !u.username && !u.password &&
  (u.hostname==='fonts.googleapis.com'&&type==='stylesheet'||u.hostname==='fonts.gstatic.com'&&type==='font');
}

export async function capture(tree,treeDir,outDir,widths,url=null,allowedOrigin=null,options={}){
 fs.mkdirSync(outDir,{recursive:true});
 if(url&&(!allowedOrigin||new URL(url).origin!==allowedOrigin))throw new Error('Preview must use the configured WordPress origin.');
 let saved=null;
 if(url&&process.env.STUDIO_BROWSER_SESSION&&process.env.STUDIO_BROWSER_SESSION_KEY){const session=unlockVault(process.env.STUDIO_BROWSER_SESSION,process.env.STUDIO_BROWSER_SESSION_KEY);if(session.origin!==allowedOrigin)throw Error('Browser session belongs to another website. Reconnect it.');saved=session.state;}
 const browser=await chromium.launch({executablePath:findBrowser(),headless:!saved});const results=[];
 try{for(const width of widths){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',...(saved?{storageState:saved}:{})});
  const blockedResources=[];
  await page.route('**/*',route=>{const request=route.request();if(allowedPreviewResource(request.url(),request.resourceType(),allowedOrigin))return route.continue();const u=new URL(request.url());blockedResources.push({origin:u.origin,type:request.resourceType()});return route.abort();});
  const hasLogin=async()=> (await page.context().cookies(allowedOrigin)).some(c=>c.name.startsWith('wordpress_logged_in_')&&(c.expires===-1||c.expires>Date.now()/1000));
  let sessionValid=false;
  if(url&&saved&&await hasLogin()){
   const probe=await page.goto(new URL('/wp-admin/',allowedOrigin).href,{waitUntil:'domcontentloaded',timeout:30000});
   sessionValid=!!probe?.ok()&&!new URL(page.url()).pathname.includes('wp-login')&&await hasLogin();
  }
  if(url&&!sessionValid&&process.env.WP_BROWSER_PASSWORD){
   const loginResponse=await page.goto(new URL('/wp-login.php',allowedOrigin).href,{waitUntil:'domcontentloaded',timeout:30000});
   if(!loginResponse?.ok())throw new Error(`WordPress browser login endpoint returned ${loginResponse?.status()}. The site denied the login page before credentials could be submitted.`);
   await page.locator('#user_login').fill(process.env.WP_BROWSER_USERNAME||process.env.WP_API_USERNAME||'');
   await page.locator('#user_pass').fill(process.env.WP_BROWSER_PASSWORD);
   await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:30000}),page.locator('#wp-submit').click()]);
   if(new URL(page.url()).pathname.includes('wp-login'))throw new Error('Draft browser login failed. Configure a WordPress login password, not an application password.');
   const authenticated=(await page.context().cookies(allowedOrigin)).some(c=>c.name.startsWith('wordpress_logged_in_'));
   if(!authenticated)throw new Error('WordPress did not establish a logged-in browser session. Check browser credentials, two-factor authentication, or a login challenge.');
  }
  if(url&&options.requireAuthentication&&!await hasLogin())throw Error('Browser access is not connected. Unlock your saved connections if they contain the preview password, or use Integrations → Open WordPress sign-in browser → Use this browser session. No AI conversion or import has started.');
  if(url){const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});if(!response?.ok()){
   const authenticated=(await page.context().cookies(allowedOrigin)).some(c=>c.name.startsWith('wordpress_logged_in_'));
   const details={status:response?.status(),authenticated,title:await page.title(),loginConfigured:!!process.env.WP_BROWSER_PASSWORD};
   fs.writeFileSync(path.join(outDir,'access-error.json'),JSON.stringify(details,null,2));
   if(!await page.locator('input[type="password"]').count())await page.screenshot({path:path.join(outDir,'access-error.png')});
   throw new Error(`Frontend returned ${response?.status()}. ${authenticated?'WordPress login succeeded, but this browser was denied draft access. Check the preview account permissions and site security rules.':'No authenticated WordPress session is present. Configure the separate draft browser login.'} Access diagnostics were saved.`);
  }}
  else await page.setContent(previewHTML(tree,treeDir),{waitUntil:'load',timeout:30000});
  if(options.accessOnly){
   if(new URL(page.url()).pathname.includes('wp-login')||!await hasLogin())throw Error('WordPress did not accept the browser session. Complete sign-in in Integrations before conversion.');
   results.push({authenticated:true});await page.close();continue;
  }
  await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,5000))]));
  await page.evaluate(()=>Promise.race([Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,5000))]));
  if(url&&!await page.locator('[id^="brxe-"]').count())throw new Error('Frontend contains no Bricks elements. Draft access or rendering must be configured.');
  const metrics=await page.evaluate(()=>({width:innerWidth,height:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length,elements:[...document.querySelectorAll('[id^="brxe-"]')].map(e=>{
   const b=e.getBoundingClientRect(),s=getComputedStyle(e);
   const textLeaf=e.matches('.brxe-heading,.brxe-text,.brxe-text-basic,.brxe-button,.brxe-text-link');
   const clippedText=textLeaf&&!!e.textContent.trim()&&((['hidden','clip'].includes(s.overflowX)&&e.scrollWidth>e.clientWidth+1)||(['hidden','clip'].includes(s.overflowY)&&e.scrollHeight>e.clientHeight+1));
   const parent=e.parentElement?.closest('[id^="brxe-"]');
   return {id:e.id.slice(5),parentId:parent?.id.slice(5)||null,x:b.x,y:b.y+scrollY,width:b.width,height:b.height,display:s.display,padding:s.padding,margin:s.margin,gap:s.gap,rowGap:s.rowGap,columnGap:s.columnGap,fontSize:s.fontSize,fontFamily:s.fontFamily,fontWeight:s.fontWeight,letterSpacing:s.letterSpacing,lineHeight:s.lineHeight,color:s.color,borderRadius:s.borderRadius,alignItems:s.alignItems,justifyContent:s.justifyContent,flexDirection:s.flexDirection,gridTemplateColumns:s.gridTemplateColumns,backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage.replace(/url\([^)]*\)/g,'url([asset])'),objectFit:s.objectFit,image:e instanceof HTMLImageElement?{naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight}:undefined,brokenImage:e instanceof HTMLImageElement&&(!e.complete||!e.naturalWidth),clippedText};
  })}));
  metrics.blockedResources=blockedResources;
  metrics.fontFaces=await page.evaluate(()=>[...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight})));
  // Computed font-family alone only reports the requested family, even when
  // Chrome rendered a fallback. Inspect the fonts actually used for text.
  const cdp=await page.context().newCDPSession(page);
  try {
   await cdp.send('DOM.enable');await cdp.send('CSS.enable');
   const {root}=await cdp.send('DOM.getDocument');const checked=new Set();metrics.fontIssues=[];
   const textElements=new Set(tree.filter(e=>['text','text-basic','heading','button','text-link'].includes(e.name)).map(e=>e.id));
   for(const element of metrics.elements){
    // PlatformFonts includes descendants. A layout wrapper can inherit a
    // theme font while its text children intentionally use another family.
    // Inspect editable text elements only, never infer failure from wrappers.
    if(!textElements.has(element.id))continue;
    const family=element.fontFamily.split(',')[0].trim().replace(/["']/g,'');
    if(checked.has(element.id))continue;
    const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:`#brxe-${element.id}`});
    if(!nodeId)continue;const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
    if(!fonts.length)continue;checked.add(element.id);
    if(!['serif','sans-serif','monospace','system-ui','Arial'].includes(family)&&!fonts.some(f=>matchesRenderedFont(family,f.familyName)))metrics.fontIssues.push({requested:family,rendered:fonts.map(f=>f.familyName),elementId:element.id});
   }
  } finally {await cdp.detach();}
  if(metrics.height>40000)throw new Error('Preview exceeds the 40,000px capture limit. Review a smaller frame.');
  await page.screenshot({path:path.join(outDir,`${width}.png`),fullPage:true});results.push(metrics);await page.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(outDir,'metrics.json'),JSON.stringify(results,null,2));return results;
}
export async function compare(reference,actual,outDir,referenceWidth=null){
 // Equal scale and padded canvas: never resize each page independently to fit.
 let a=await sharp(reference).metadata();const b=await sharp(actual).metadata();
 // Figma exports may be 2x. Normalize only the reference using its source frame
 // width; never stretch the browser capture to hide overflow or wrong heights.
 if(referenceWidth){const scaled=await sharp(reference).resize({width:referenceWidth}).toBuffer();reference=scaled;a=await sharp(scaled).metadata();}
 const factor=Math.min(1,1000/Math.max(a.width,b.width)),w=Math.ceil(Math.max(a.width,b.width)*factor),h=Math.ceil(Math.max(a.height,b.height)*factor);
 if(w*h>24000000)throw new Error('Comparison exceeds image budget.');
 const prepare=async(file,m)=>{const image=await sharp(file).resize(Math.max(1,Math.round(m.width*factor)),Math.max(1,Math.round(m.height*factor))).flatten({background:'#fff'}).toBuffer();return sharp({create:{width:w,height:h,channels:3,background:'#fff'}}).composite([{input:image,left:0,top:0}]).removeAlpha().raw().toBuffer();};
 const [aa,bb]=await Promise.all([prepare(reference,a),prepare(actual,b)]);const heat=Buffer.alloc(aa.length);let sum=0;
 for(let i=0;i<aa.length;i+=3){const d=(Math.abs(aa[i]-bb[i])+Math.abs(aa[i+1]-bb[i+1])+Math.abs(aa[i+2]-bb[i+2]))/3;sum+=d;heat[i]=255;heat[i+1]=heat[i+2]=Math.round(255-d);}
 await sharp(heat,{raw:{width:w,height:h,channels:3}}).png().toFile(path.join(outDir,'heatmap.png'));
 const overlay=Buffer.from(aa.map((v,i)=>Math.round((v+bb[i])/2)));await sharp(overlay,{raw:{width:w,height:h,channels:3}}).png().toFile(path.join(outDir,'overlay.png'));
 return {pixelError:sum/(w*h*255),note:'Pixel error is diagnostic, not proof of visual or interactive correctness.'};
}
