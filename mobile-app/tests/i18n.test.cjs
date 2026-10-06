// Plain Node: real dictionaries/store/formatters; only AsyncStorage is mocked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {root,read,sourceFiles,ts,assert}=require('./regression-harness.cjs');
function runtime(saved='en',failRead=false){
 const cache=new Map(),storage=new Map([['app_language',saved]]);
 const load=p=>{
  p=path.resolve(root,p);if(cache.has(p))return cache.get(p).exports;
  const m={exports:{}};cache.set(p,m);
  const code=ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
  const req=id=>{
   if(id==='@react-native-async-storage/async-storage')return {getItem:async k=>{if(failRead)throw Error('storage unavailable');return storage.get(k)||null;},setItem:async(k,v)=>storage.set(k,v)};
   if(id.startsWith('.')){const b=path.resolve(path.dirname(p),id);return load([b+'.ts',b+'.tsx',path.join(b,'index.ts')].find(fs.existsSync));}
   return require(id);
  };
  vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{__DEV__:false,console},{filename:p})(req,m,m.exports);
  return m.exports;
 };
 return {load,storage};
}
const checks=[];const check=(name,fn)=>checks.push({name,fn});
const placeholders=s=>[...s.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(m=>m[1]).sort();
check('English/Urdu key parity, nonempty values and matching named placeholders',()=>{
 const r=runtime(),en=r.load('src/i18n/en.ts').en,ur=r.load('src/i18n/ur.ts').ur;
 assert.deepEqual(Object.keys(en).sort(),Object.keys(ur).sort());
 for(const k of Object.keys(en)){
  assert.ok(en[k].trim()&&ur[k].trim(),k+' is empty');
  assert.deepEqual(placeholders(en[k]),placeholders(ur[k]),k+' placeholders differ');
  // No "Rs." and no Arabic-Indic digits: money and dates are rendered by formatCurrency and
  // the date helpers, in English, so a localized digit in a label would mismatch the figure
  // beside it. Plain ASCII digits inside an example ("e.g. 0300 1234567") are fine.
  assert.ok(!/Rs\.|[٠-٩۰-۹]/.test(ur[k]),k+' contains currency or localized digits');
 }
 assert.ok(read('src/i18n/en.ts').includes('as const'));
 assert.ok(read('src/i18n/ur.ts').includes('Record<TKey, string>'));
 for(const k of ['registerBtn','registerTitle','createAccount','bizName','passLen'])assert.ok(!(k in en),'dead public registration key '+k);
 assert.notEqual(en.welcome,'welcome');assert.notEqual(ur.welcome,'welcome');
});
check('Every literal t() key in source exists in both dictionaries',()=>{
 const r=runtime(),en=r.load('src/i18n/en.ts').en,ur=r.load('src/i18n/ur.ts').ur;
 for(const file of sourceFiles(path.join(root,'src'))){
  const sf=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const visit=n=>{
   if(ts.isCallExpression(n)&&(/^(t|.*\.t)$/.test(n.expression.getText(sf)))){
    // Both t('literal') AND t(cond ? 'a' : 'b'). The conditional form used to be skipped
   // entirely, and a missing key is not a blank label: translate() calls .replace() on
   // the looked-up value, so an absent key is a TypeError the moment the screen renders.
   const arg=n.arguments[0];
   const literals=!arg?[]
    :ts.isStringLiteral(arg)?[arg]
    :ts.isConditionalExpression(arg)?[arg.whenTrue,arg.whenFalse].filter(ts.isStringLiteral)
    :[];
   for(const lit of literals)assert.ok(lit.text in en&&lit.text in ur,file+': missing '+lit.text);
   }ts.forEachChild(n,visit);
  };visit(sf);
 }
});
check('Named interpolation is literal, repeated, order-independent and preserves missing tokens',()=>{
 const r=runtime(),en=r.load('src/i18n/en.ts').en,{translate}=r.load('src/i18n/translate.ts');
 en.fromDate='{name}: {date} / {name}';
 assert.equal(translate('en','fromDate',{date:'13 Sep 2026',name:'$&'}),'$&: 13 Sep 2026 / $&');
 assert.equal(translate('en','fromDate',{}),'{name}: {date} / {name}');
 assert.equal(translate('ur','editedEvent',{name:'Ahmed'}),'یہ اندراج تبدیل کیا: Ahmed');
});
check('Saved language is restored, toggles persist, unavailable storage finishes loading',async()=>{
 for(const lang of ['en','ur']){
  const r=runtime(lang),store=r.load('src/store/useLanguageStore.ts').useLanguageStore;
  assert.equal(store.getState().isLoaded,false);await store.getState().loadLanguage();
  assert.equal(store.getState().isLoaded,true);assert.equal(store.getState().language,lang);
  const before=store.getState().t('welcome');await store.getState().toggleLanguage();
  assert.notEqual(store.getState().t('welcome'),before);
  assert.equal(r.storage.get('app_language'),store.getState().language);
 }
 const r=runtime('en',true),store=r.load('src/store/useLanguageStore.ts').useLanguageStore;
 await store.getState().loadLanguage();assert.equal(store.getState().isLoaded,true);
});
check('Boot restores language before DB/session and gates rendering; Login does not restore it',()=>{
 const boot=read('src/navigation/AppNavigator.tsx'),login=read('src/screens/auth/LoginScreen.tsx');
 assert.ok(boot.indexOf('await loadLanguage()')<boot.indexOf('await getDatabase()'));
 assert.ok(boot.indexOf('await loadLanguage()')<boot.indexOf('await checkSession()'));
 assert.ok(boot.indexOf('if (!isLoaded)')<boot.indexOf('<NavigationContainer'));
 assert.ok(boot.indexOf('if (!isLoaded)')<boot.indexOf("t('loading')"));
 assert.ok(!/loadLanguage/.test(login));
});
check('Currency is byte-identical and ASCII under English and Urdu, in EVERY currency; dates remain en-PK',async()=>{
 const r=runtime(),store=r.load('src/store/useLanguageStore.ts').useLanguageStore;
 const {formatCurrency}=r.load('src/utils/calculations.ts'),{formatDisplayDate}=r.load('src/utils/dates.ts');
 const {CURRENCIES,CURRENCY_CODES,resolveCurrency,DEFAULT_CURRENCY}=r.load('src/utils/currency.ts');
 const values=[0,1,99,100,9999,123456,-123456,999999999];
 // The language must not reach a figure in ANY currency, not just the default.
 for(const code of CURRENCY_CODES){
  await store.getState().setLanguage('en');const before=values.map(v=>formatCurrency(v,code));
  const date=formatDisplayDate('2026-09-13');
  await store.getState().setLanguage('ur');const after=values.map(v=>formatCurrency(v,code));
  for(let i=0;i<before.length;i++){
   assert.ok(Buffer.from(before[i]).equals(Buffer.from(after[i])),code+' moved with the language');
   assert.ok(/^[\x00-\x7F]+$/.test(after[i]),code+' formatted a figure with a non-ASCII character: '+after[i]);
  }
  assert.equal(formatDisplayDate('2026-09-13'),date);
 }
 assert.equal(formatCurrency(123456),'Rs. 1,234.56','the default output is unchanged');
 assert.equal(formatCurrency(123456,'AED'),'AED 1,234.56');
 // Unknown, missing and stray arguments are PKR — never a throw and never "undefined"
 // beside a figure. Mapping the formatter over an array passes the array INDEX as the
 // second argument, which is exactly this case and is why the resolver must be total.
 for(const junk of [undefined,null,'','pkr','KWD','XXX',0,3,{},NaN])
  assert.equal(formatCurrency(123456,junk),'Rs. 1,234.56','not a currency code: '+String(junk));
 assert.deepEqual(values.map(formatCurrency),values.map(v=>formatCurrency(v,DEFAULT_CURRENCY)));
 // The money layer divides by 100 everywhere, so a 1000-minor-unit currency cannot be
 // added to the table without changing the converters. See CLAUDE.md.
 for(const code of CURRENCY_CODES){
  assert.equal(CURRENCIES[code].minorUnits,100,code+' breaks the integer-minor-unit assumption');
  assert.ok(/^[\x00-\x7F]+$/.test(CURRENCIES[code].prefix),code+' has a non-ASCII prefix');
  assert.equal(resolveCurrency(code).code,code);
 }
 assert.deepEqual([...CURRENCY_CODES].sort(),['AED','CNY','PKR','USD'],'the currency list is closed');
 assert.equal(CURRENCIES.PKR.locale,'en-PK','rupees stay pinned to en-PK');
 assert.ok(!/useLanguageStore/.test(read('src/utils/calculations.ts')),'the formatter reads the language');
 assert.ok(read('src/utils/dates.ts').includes("toLocaleDateString('en-PK'"));
});
check('No forced RTL anywhere; translated shared components do not mix figures with labels',()=>{
 for(const f of sourceFiles(path.join(root,'src')))assert.ok(!/\bforceRTL\s*\(/.test(fs.readFileSync(f,'utf8')),f+' forces RTL');
 const files=['src/components/TopHeaderWithBooks.tsx','src/components/Download/DownloadOptionsModal.tsx','src/components/ui/EntryHistory.tsx','src/components/ui/DateField.tsx','src/components/ui/DateRangeFilter.tsx','src/components/OfflineBanner.tsx','src/components/SuccessModal.tsx','src/components/CountryCodePicker.tsx','src/components/reports/DateFilterPicker.tsx'];
 for(const f of files){
  const text=read(f);assert.ok(!/writingDirection/.test(text),f+' overrides bidi direction');
  const sf=ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function visit(n){
   if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(sf)==='Text'){
    const body=n.children.map(c=>c.getText(sf)).join(' ');
    if(/formatCurrency|formatDisplayDate|valueText/.test(body))assert.ok(!/\bt\(/.test(body),f+' combines a figure/date and a translated label');
   }ts.forEachChild(n,visit);
  }visit(sf);
 }
});

// ── Converted files must carry NO hardcoded user-facing text ─────────────────
// Each rollout stage appends its screens here; the scan is AST-based so it cannot be
// fooled by formatting. Flagged: JSX text with letters, string literals rendered
// directly inside JSX braces or ternaries, user-facing string props, Alert.alert
// string arguments and button labels. Allowed: emoji/punctuation-only text, format
// names and file extensions, navigation route names and style tokens (never shown).
const CONVERTED=[
 'src/components/TopHeaderWithBooks.tsx','src/components/OfflineBanner.tsx','src/components/SuccessModal.tsx',
 'src/components/CountryCodePicker.tsx','src/components/TranslateToUrdu.tsx','src/components/ui/CustomerAvatar.tsx',
 'src/components/ui/DateField.tsx','src/components/ui/DateRangeFilter.tsx','src/components/ui/EntryHistory.tsx',
 'src/components/reports/DateFilterPicker.tsx','src/components/Download/DownloadOptionsModal.tsx','src/navigation/AppNavigator.tsx',
 // The three book heroes carried hardcoded English behind a green suite until
 // 2026-10-06 ("Total expense — ", "Total sale … bills", "Today balance").
 'src/screens/ExpenseBook/ExpenseBookScreen.tsx','src/screens/BillBook/BillBookScreen.tsx',
 'src/screens/CashBook/CashBookScreen.tsx',
];
const ALLOWED_LITERALS=new Set(['PDF','CSV','.pdf','.csv','application/pdf','text/csv','U','?','✓','✕','×','▼','📅','🔔','Rs.']);
const USER_FACING_PROPS=new Set(['placeholder','title','message','accessibilityLabel','label','headerTitle','tabBarLabel','dialogTitle']);
const hasWords=s=>/[A-Za-z]{2,}/.test(s.replace(/&[a-z]+;/g,''));
function hardcodedStrings(file){
 const text=fs.readFileSync(path.join(root,file),'utf8');
 const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const hits=[];const flag=(node,value)=>{value=value.replace(/\s+/g,' ').trim();if(value&&hasWords(value)&&!ALLOWED_LITERALS.has(value))hits.push(value+' @'+(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1));};
 const insideT=n=>{for(let p=n.parent;p;p=p.parent)if(ts.isCallExpression(p)&&/^(t|.*\.t)$/.test(p.expression.getText(sf)))return true;return false;};
 function visit(n){
  if(ts.isJsxText(n))flag(n,n.getText(sf));
  else if(ts.isJsxExpression(n)&&n.expression&&!ts.isJsxAttribute(n.parent)){
   const e=n.expression;
   if(ts.isStringLiteral(e)||ts.isNoSubstitutionTemplateLiteral(e))flag(e,e.text);
   if(ts.isConditionalExpression(e))for(const b of [e.whenTrue,e.whenFalse])if(ts.isStringLiteral(b)||ts.isNoSubstitutionTemplateLiteral(b))flag(b,b.text);
   if(ts.isTemplateExpression(e)&&!insideT(e)){flag(e,e.head.text);for(const sp of e.templateSpans)flag(sp,sp.literal.text);}
  }
  else if(ts.isJsxAttribute(n)&&USER_FACING_PROPS.has(n.name.getText(sf))&&n.initializer){
   const i=n.initializer;
   if(ts.isStringLiteral(i))flag(i,i.text);
   else if(ts.isJsxExpression(i)&&i.expression&&(ts.isStringLiteral(i.expression)||ts.isNoSubstitutionTemplateLiteral(i.expression)))flag(i,i.expression.text);
   else if(ts.isJsxExpression(i)&&i.expression&&ts.isTemplateExpression(i.expression)&&!insideT(i.expression))flag(i,i.expression.head.text);
   // label={cond ? 'Today balance' : 'Day balance'} — each branch is a hardcoded label in
   // its own right. The generic conditional case below skips attribute initializers, so
   // without this the Cash Book shipped exactly that past a green suite.
   else if(ts.isJsxExpression(i)&&i.expression&&ts.isConditionalExpression(i.expression)){
    for(const b of [i.expression.whenTrue,i.expression.whenFalse])
     if(ts.isStringLiteral(b)||ts.isNoSubstitutionTemplateLiteral(b))flag(b,b.text);
   }
  }
  else if(ts.isCallExpression(n)&&/Alert\.alert$/.test(n.expression.getText(sf))){
   for(const a of n.arguments.slice(0,2))if(ts.isStringLiteral(a)||ts.isNoSubstitutionTemplateLiteral(a))flag(a,a.text);
  }
  else if(ts.isPropertyAssignment(n)&&/^(text|label|title|message)$/.test(n.name.getText(sf))&&(ts.isStringLiteral(n.initializer)||ts.isNoSubstitutionTemplateLiteral(n.initializer))&&!insideT(n))flag(n,n.initializer.text);
  ts.forEachChild(n,visit);
 }
 visit(sf);return hits;
}
check('Converted screens and components contain no hardcoded user-facing strings',()=>{
 const failures=[];
 for(const f of CONVERTED){const hits=hardcodedStrings(f);if(hits.length)failures.push(f+'\n    '+hits.join('\n    '));}
 assert.equal(failures.length,0,'Hardcoded strings remain:\n  '+failures.join('\n  '));
 // The scanner itself must catch what it claims to: a fixture with every pattern.
 const fixture=path.join(root,'tests','.i18n-fixture.tsx');
 const BT=String.fromCharCode(96);
 fs.writeFileSync(fixture,"const A=()=><T>Hello there<T placeholder=\"Type here\" label={ok?'Paid':'Unpaid'}>{'Literal'}{ok?'Yes':'No'}{"+BT+"Photo of ${x}"+BT+"}</T>{Alert.alert('Oops','Failed')}{[{text:'Cancel'}]}</T>;");
 try{const hits=hardcodedStrings(path.relative(root,fixture));assert.equal(hits.length,11,'scanner missed patterns: '+hits.join(' | '));}finally{fs.unlinkSync(fixture);}
});
(async()=>{let passed=0;for(const c of checks){try{await c.fn();passed++;console.info('PASS '+c.name);}catch(e){console.error('FAIL '+c.name+'\n'+e.stack);}}console.info(`TOTAL ${checks.length}: ${passed} PASS, ${checks.length-passed} FAIL`);process.exitCode=passed===checks.length?0:1;})();
