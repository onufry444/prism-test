// Szybki test generatora: tworzy pliki i uruchamia je w bash (jeśli jest).
const os=require('os'),path=require('path'),fs=require('fs'),{execFileSync}=require('child_process');
const {writeAll}=require('../src/commands');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-'));
const cmds=[{name:'hej',type:'text',body:'Cześć {1}! "cytat" $HOME `x` \\n {args}'},
 {name:'dwa',type:'run',body:'echo pierwszy {1}; echo drugi'},{name:'zla nazwa',type:'text',body:'x'},{name:'komendy',type:'text',body:'x'}];
const ok=writeAll(dir,cmds,'linux');
console.log('poprawne:',ok.map(c=>c.name).join(','));
try{
 const out=execFileSync('bash',['--rcfile',path.join(dir,'init.bash'),'-i'],{input:'hej Ola Ala\ndwa X\nkomendy | head -3\nexit\n',env:{...process.env,HOME:dir},encoding:'utf8',stdio:['pipe','pipe','pipe']});
 console.log(out);
}catch(e){console.log('bash:',e.stdout,e.stderr)}
console.log(fs.readFileSync(path.join(dir,'commands.ps1'),'utf8').slice(0,900));
console.log(fs.readFileSync(path.join(dir,'macros.doskey'),'utf8'));
