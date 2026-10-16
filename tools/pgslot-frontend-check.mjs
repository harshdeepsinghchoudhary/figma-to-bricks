import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { findBrowser } from '../scripts/preview.js';
const url = process.argv[2];
if (!url || new URL(url).hostname !== 'casinodesign.bcit.in') throw new Error('Expected the PG Slot staging host');
const out = '.review-work/pgslot-live'; fs.mkdirSync(out,{recursive:true});
const candidate=process.argv.includes('--candidate');
const label=candidate?'candidate':'frontend';
const browser = await chromium.launch({executablePath:findBrowser(),headless:true});
try {
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(url,{waitUntil:'networkidle'});
 await page.locator('.brxe-section').first().waitFor({timeout:20000});
 console.log('Frontend loaded');
 if(candidate){
  const render=JSON.parse(fs.readFileSync(out+'/candidate-render.json'));
  await page.evaluate(({html,css})=>{
   for(const style of document.querySelectorAll('style')) if(style.textContent.includes('#brxe-7wp8qs')) style.remove();
   document.querySelector('#brx-content').innerHTML=html;
   const style=document.createElement('style');style.textContent=css;document.head.append(style);
   window.bricksSplide();window.bricksAccordion();window.bricksOffcanvas?.();window.bricksToggle?.();window.bricksNavNested?.();
  },render);
  await page.evaluate(async()=>{await Promise.race([Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise(resolve=>setTimeout(resolve,10000))]);});
  console.log('Candidate initialized');
 }
 await page.screenshot({path:out+'/'+label+'.png',fullPage:true});
 fs.writeFileSync(out+'/'+label+'.html',await page.content());
 const report = await page.evaluate(()=>({
  width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
  menu:[...document.querySelectorAll('#brxe-lxiu0r, #brxe-m5tltd, #brxe-duwtpt, #brxe-duwtpt p')].map(e=>({id:e.id,tag:e.tagName,box:e.getBoundingClientRect().toJSON(),font:getComputedStyle(e).font,margin:getComputedStyle(e).margin})),
  fonts:[...document.fonts].filter(f=>f.family.includes('Inter')).map(f=>({family:f.family,weight:f.weight,status:f.status})),
  sliders:[...document.querySelectorAll('.brxe-slider-nested')].map(e=>({id:e.id,options:e.getAttribute('data-splide'),arrows:e.querySelectorAll('.splide__arrow').length,pagination:e.querySelector('.splide__pagination')?.outerHTML})),
  accordion:[...document.querySelectorAll('.brxe-accordion-nested')].map(e=>({id:e.id,html:e.outerHTML})),
  buttons:[...document.querySelectorAll('.bricks-button')].map(e=>({text:e.textContent,html:e.outerHTML,css:getComputedStyle(e).cssText,height:e.getBoundingClientRect().height})),
 }));
 const faq = page.locator('.brxe-accordion-nested .accordion-title-wrapper').last();
 if(await faq.count()) { await faq.click(); await page.waitForTimeout(300); report.faqAfterClick = await page.locator('.brxe-accordion-nested').evaluate(e=>({open:e.querySelectorAll('.brx-open').length,panels:[...e.querySelectorAll('.accordion-content-wrapper')].map(n=>({display:getComputedStyle(n).display,text:n.textContent}))})); await faq.click();await page.waitForTimeout(300);report.faqAfterSecondClick=await faq.getAttribute('aria-expanded'); }
 report.sections=await page.locator('#brx-content > section').evaluateAll(els=>els.map(e=>({id:e.id,y:e.getBoundingClientRect().top+scrollY,height:e.getBoundingClientRect().height})));
 const toggle = page.locator('#brxe-g9bzhv');
 if(await toggle.count()) {
  report.toggleFunctions=await page.evaluate(()=>Object.keys(window).filter(k=>/bricks.*toggle/i.test(k)));
  report.toggleBefore=await toggle.evaluate(e=>({html:e.outerHTML,target:document.querySelector(e.getAttribute('data-selector'))?.outerHTML.slice(0,350)}));
  await toggle.click();await page.waitForTimeout(200);
  report.toggleAfter=await toggle.evaluate(e=>({expanded:e.getAttribute('aria-expanded'),targetDisplay:getComputedStyle(document.querySelector(e.getAttribute('data-selector'))).display}));
  await page.keyboard.press('Escape');await page.waitForTimeout(400);
  report.toggleReopened=await toggle.getAttribute('aria-expanded');
 }
 report.headerResponsive=[];
 for(const width of [1440,1025,1024,768,478,375,320]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(150);
  report.headerResponsive.push(await page.evaluate(()=>{
   const row=document.querySelector('#brxe-kchfa6'),logo=document.querySelector('#brxe-vyxobx'),nav=document.querySelector('#brxe-rsfsp7');
   const paddingViolations=innerWidth<=1024?[...document.querySelectorAll('#brx-content [id^="brxe-"]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({id:e.id,left:parseFloat(getComputedStyle(e).paddingLeft),right:parseFloat(getComputedStyle(e).paddingRight)})).filter(e=>e.left>20.1||e.right>20.1):[];
   return {width:innerWidth,paddingViolations,row:row?.getBoundingClientRect().toJSON(),logo:logo?.getBoundingClientRect().toJSON(),rowDirection:row&&getComputedStyle(row).flexDirection,navDisplay:nav&&getComputedStyle(nav).display,overflow:row?[...row.querySelectorAll('*')].some(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>innerWidth+1||b.left<0)}):null};
  }));
  if([1024,375].includes(width)){await page.locator('#brxe-kchfa6').screenshot({path:out+`/header-${width}.png`});}
  if([1024,768,375].includes(width)){
   report.footerResponsive ||= [];
   report.footerResponsive.push(await page.locator('#brxe-k142g3').evaluate(e=>({width:innerWidth,direction:getComputedStyle(e).flexDirection,wrap:getComputedStyle(e).flexWrap,columns:[...e.children].map(c=>c.getBoundingClientRect().toJSON())})));
   await page.locator('#brxe-k142g3').screenshot({path:out+`/footer-${width}.png`});
   report.footerMenus ||= [];report.footerMenus.push(await page.locator('#brxe-k142g3').evaluate(e=>({width:innerWidth,menus:e.querySelectorAll('.brxe-nav-menu').length,visibleToggles:[...e.querySelectorAll('.bricks-mobile-menu-toggle')].filter(t=>getComputedStyle(t).display!=='none').length})));
   await page.locator('#brxe-tfp6s7').screenshot({path:out+`/banking-${width}.png`});
   report.sideImage ||= [];report.sideImage.push(await page.locator('#brxe-j0rr4n').evaluate(e=>({width:innerWidth,maxWidth:getComputedStyle(e).maxWidth,renderedWidth:e.getBoundingClientRect().width})));
  }
  if(width===375){
    report.cardPhone=await page.locator('#brxe-zvxx07').evaluate(e=>({box:e.getBoundingClientRect().toJSON(),overflow:[...e.querySelectorAll('*')].filter(c=>c.getBoundingClientRect().right>e.getBoundingClientRect().right+1).map(c=>c.id)}));
    await page.locator('#brxe-1tw723').screenshot({path:out+'/card-375.png'});
  }
 }
 fs.writeFileSync(out+'/'+label+'-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({sliders:report.sliders.map(s=>({id:s.id,options:s.options,arrows:s.arrows})),faqAfterClick:report.faqAfterClick,width:report.width,scrollWidth:report.scrollWidth},null,2));
} finally {await browser.close();}

