// Resolve the real client modules for Node's existing data-URL test loaders.
const fs=require('node:fs'),path=require('node:path');
const cache=new Map();
function clientSource(name){
  if(cache.has(name))return cache.get(name);
  const file=path.resolve(__dirname,'../..',name);
  const text=fs.readFileSync(file,'utf8').replace(/(from\s+|import\s*)(["'])(\.{1,2}\/[^"']+\.js)\2/g,(_match,prefix,_quote,relative)=>{
    const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(name),relative));
    return prefix+JSON.stringify('data:text/javascript;base64,'+Buffer.from(clientSource(dependency)).toString('base64'));
  });
  cache.set(name,text);return text;
}
module.exports={clientSource};
