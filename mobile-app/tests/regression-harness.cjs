// Shared harness: real SQLite in disposable files; only native/platform boundaries mocked.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const dbSource = read('src/services/database/db.ts');
const latest = Math.max(...[...dbSource.matchAll(/if \(version < (\d+)\)/g)].map(m => +m[1]));
function sourceFiles(dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', '.git', '.expo', 'dist', 'build', 'web-build', 'tests'].includes(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : /\.[cm]?[jt]sx?$/.test(p) ? [p] : [];
  });
}
const location = (p, needle) => {
  const text = read(p); const pos = text.indexOf(needle);
  return p + ':' + (pos < 0 ? 1 : text.slice(0, pos).split('\n').length);
};
function capMigrations(source, ceiling) {
  // Test-only historical fixture builder: omit later version blocks, retaining all
  // original SQL and the original control flow of migrations through the ceiling.
  const ast = ts.createSourceFile('db.ts', source, ts.ScriptTarget.Latest, true);
  const cuts = [];
  function visit(node) {
    if (ts.isIfStatement(node)) {
      const match = /^version\s*<\s*(\d+)$/.exec(node.expression.getText(ast));
      if (match && +match[1] > ceiling) { cuts.push([node.getStart(ast), node.end]); return; }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const [start,end] of cuts.sort((a,b)=>b[0]-a[0])) source = source.slice(0,start) + source.slice(start,end).replace(/[^\r\n]/g,' ') + source.slice(end);
  return source;
}
function harness() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'digikhata-regression-'));
  const sqlite = new DatabaseSync(path.join(folder, 'isolated.db'), { enableDoubleQuotedStringLiterals: true });
  // Expo SQLite's default; the application does not enable foreign keys.
  sqlite.exec('PRAGMA foreign_keys = OFF');
  let depth=0, cap=Infinity;
  let session={isAuthenticated:true,user:{id:'owner'}};
  const cache=new Map(), queries=[], html=[], csv=[], versions=[], files=[], logs=[];
  // Files that exist on the simulated phone. A copied file exists at its destination;
  // anything else exists only if a test says so — which is how a check models a
  // picker-cache file that Android has already cleared.
  const present=new Set();
  const wrap = (sql, fn) => {
    queries.push(sql);
    try { const r=fn(); const m=/PRAGMA user_version\s*=\s*(\d+)/i.exec(sql); if(m) versions.push(+m[1]); return r; }
    catch(e) { throw new Error(e.message + '\nSQL: ' + sql.replace(/\s+/g,' ').slice(0,260)); }
  };
  const adapter={
    execAsync: async sql=>wrap(sql,()=>sqlite.exec(sql)),
    runAsync: async (sql,args=[])=>wrap(sql,()=>sqlite.prepare(sql).run(...args)),
    getAllAsync: async (sql,args=[])=>wrap(sql,()=>sqlite.prepare(sql).all(...args)),
    getFirstAsync: async (sql,args=[])=>wrap(sql,()=>sqlite.prepare(sql).get(...args)||null),
    closeAsync: async ()=>{},
    withTransactionAsync: async fn=>{
      assert.equal(depth,0,'nested SQLite transaction'); sqlite.exec('BEGIN'); depth++;
      try { const r=await fn(adapter);sqlite.exec('COMMIT');return r; }
      catch(e){sqlite.exec('ROLLBACK');throw e;} finally{depth--;}
    },
  };
  adapter.withExclusiveTransactionAsync=adapter.withTransactionAsync;
  const sync={isOnline:false,incrementPendingCount(){},processSyncQueue:async()=>{assert.equal(depth,0);}};
  function load(file) {
    file=path.resolve(root,file);
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    let source=fs.readFileSync(file,'utf8');
    if(file===path.join(root,'src/services/database/db.ts') && cap!==Infinity)source=capMigrations(source,cap);
    const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText;
    function req(id) {
      if(id==='expo-sqlite')return {openDatabaseAsync:async()=>adapter};
      if(id==='expo-crypto')return {getRandomBytes:n=>crypto.randomBytes(n),CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(algorithm,value)=>crypto.createHash(algorithm).update(value).digest('hex')};
      if(id==='expo-print')return {printToFileAsync:async({html:body})=>{html.push(body);return {uri:'test://report.pdf'};}};
      if(id==='expo-file-system')return {documentDirectory:'test://',EncodingType:{UTF8:'utf8'},writeAsStringAsync:async(uri,body)=>{csv.push(body);},
        makeDirectoryAsync:async(dir)=>{files.push({op:'mkdir',dir});},copyAsync:async({from,to})=>{files.push({op:'copy',from,to});present.add(to);},
        getInfoAsync:async(uri)=>({exists:present.has(uri),uri})};
      if(id==='expo-image-picker')return {MediaTypeOptions:{Images:'Images'}};
      if(id==='react-native')return {Alert:{alert(){}}};
      if(id.endsWith('/authStore'))return {useAuthStore:{getState:()=>session}};
      if(id.endsWith('/useSyncStore'))return {useSyncStore:{getState:()=>sync}};
      if(id.startsWith('.')) {
        const base=path.resolve(path.dirname(file),id);
        const resolved=[base+'.ts',base+'.tsx',path.join(base,'index.ts'),base+'.js'].find(fs.existsSync);
        if(!resolved)throw Error('Unresolved application import '+id+' from '+file);
        return load(resolved);
      }
      return require(id);
    }
    const record=(...a)=>{logs.push(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '));};
    vm.runInNewContext('(function(require,module,exports){'+output+'\n})',{console:{log:record,warn:record,error:record,info:record},__DEV__:true},{filename:file})(req,module,module.exports);
    return module.exports;
  }
  const all=(sql,...args)=>sqlite.prepare(sql).all(...args);
  const one=(sql,...args)=>sqlite.prepare(sql).get(...args);
  const insert=(table, overrides={})=>{
    const ddl=one('SELECT sql FROM sqlite_master WHERE type=? AND name=?','table',table)?.sql;
    assert.ok(ddl,'Missing fixture table '+table);
    const columns=all('PRAGMA table_info('+table+')'); const data={...overrides};
    for(const c of columns) {
      if(Object.hasOwn(data,c.name))continue;
      if(c.pk){data[c.name]=table+'_'+crypto.randomUUID();continue;}
      if(!c.notnull || c.dflt_value!==null)continue;
      const enumMatch=new RegExp('\\b'+c.name+'\\s+[^,]*?CHECK\\s*\\(\\s*'+c.name+'\\s+IN\\s*\\(([^)]+)','i').exec(ddl);
      if(enumMatch){data[c.name]=/'([^']+)'/.exec(enumMatch[1])[1];continue;}
      data[c.name]=/INT|REAL|NUM|FLOAT|DOUBLE/i.test(c.type)?1:/date|At$|_at$/.test(c.name)?'2026-09-08':'fixture';
    }
    const keys=Object.keys(data);
    sqlite.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(data));
    return data.id;
  };
  return {sqlite,adapter,queries,html,csv,versions,files,present,logs,load,all,one,insert,
    login:id=>{session={isAuthenticated:true,user:{id}};},
    boot:async(ceiling=Infinity)=>{cap=ceiling;cache.clear();await load('src/services/database/db.ts').getDatabase();},
    dispose:()=>{sqlite.close();fs.rmSync(folder,{recursive:true,force:true});},
  };
}
module.exports={root,read,sourceFiles,location,latest,harness,ts,assert};
