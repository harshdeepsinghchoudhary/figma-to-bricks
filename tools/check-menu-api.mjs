import 'dotenv/config';
const site=process.env.WP_API_URL.split('/wp-json')[0];
const headers={Authorization:'Basic '+Buffer.from(`${process.env.WP_API_USERNAME}:${process.env.WP_API_PASSWORD}`).toString('base64')};
for(const route of ['menus','menu-items','menu-locations']) {
 const r=await fetch(`${site}/wp-json/wp/v2/${route}`,{method:'OPTIONS',headers,signal:AbortSignal.timeout(30000)});
 const data=await r.json(); console.log(JSON.stringify({route,status:r.status,methods:data.methods,code:data.code}));
}
