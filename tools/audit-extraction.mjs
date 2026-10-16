import {spawnSync} from 'node:child_process';
const sources=[
 ['9ZC7Ja7QmEw4bpH7ue8zdC','8219-29'],
 ['npzLbyeDKUPIddvso2Kz3W','32-1096'],
 ['mMJsY2EiHFk4VaFghaUh4L','2214-2'],
 ['4wF81rXzm2dJqTSIKbNuJe','260-49'],
];
for(const [file,node] of sources){
 const result=spawnSync(process.execPath,['scripts/1_extract_figma.js',`https://www.figma.com/design/${file}/Design?node-id=${node}`],{stdio:'inherit'});
 if(result.status){process.exitCode=result.status;break;}
}
