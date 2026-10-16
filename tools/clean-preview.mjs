import fs from 'node:fs';
import path from 'node:path';
import {previewHTML,renderScreenshots} from '../scripts/preview.js';
const base=process.argv[2];
const results=[];
for(const name of fs.readdirSync(base)){
 const dir=path.join(base,name,'merged'),file=path.join(dir,'bricks-tree.json');
 if(!fs.existsSync(file))continue;
 const tree=JSON.parse(fs.readFileSync(file));
 const root=JSON.parse(fs.readFileSync(path.join(base,name,'figma-node.json')));
 const metrics=await renderScreenshots({html:previewHTML(tree,dir),outDir:path.join(base,name,'preview'),widths:[root.absoluteBoundingBox.width,1024,390]});
 const item={name,kind:'local approximation; not Bricks frontend certification',viewports:Object.values(metrics).map(m=>({width:m.width,scrollWidth:m.scrollWidth,overflow:m.overflowX,brokenImages:m.brokenImages.length}))};
 results.push(item);console.log(JSON.stringify(item));fs.writeFileSync(path.join(base,'preview-report.json'),JSON.stringify(results,null,2));
}
