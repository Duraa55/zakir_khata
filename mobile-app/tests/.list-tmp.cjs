const fs=require('fs'),path=require('path'),ts=require('typescript');
const root='D:/Zakir_Khata/mobile-app';
const ALLOWED=new Set(['PDF','CSV','.pdf','.csv','application/pdf','text/csv','U','?','✓','✕','×','▼','Rs.']);
const USER_PROPS=new Set(['placeholder','title','message','accessibilityLabel','label','headerTitle','tabBarLabel','dialogTitle']);
const hasWords=s=>/[A-Za-z]{2,}/.test(s);
function scan(file){
 const text=fs.readFileSync(file,'utf8');
 const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const hits=[];
 const flag=(n,v)=>{v=v.replace(/\s+/g,' ').trim();if(v&&hasWords(v)&&!ALLOWED.has(v))hits.push([sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,v]);};
 const insideT=n=>{for(let p=n.parent;p;p=p.parent)if(ts.isCallExpression(p)&&/^(t|.*\.t)$/.test(p.expression.getText(sf)))return true;return false;};
 (function visit(n){
  if(ts.isJsxText(n))flag(n,n.getText(sf));
  else if(ts.isJsxExpression(n)&&n.expression&&!ts.isJsxAttribute(n.parent)){
   const e=n.expression;
   if((ts.isStringLiteral(e)||ts.isNoSubstitutionTemplateLiteral(e))&&!insideT(e))flag(e,e.text);
   if(ts.isConditionalExpression(e))for(const b of [e.whenTrue,e.whenFalse])if((ts.isStringLiteral(b)||ts.isNoSubstitutionTemplateLiteral(b))&&!insideT(b))flag(b,b.text);
   if(ts.isTemplateExpression(e)&&!insideT(e)){flag(e,e.head.text);for(const sp of e.templateSpans)flag(sp,sp.literal.text);}
  }
  else if(ts.isJsxAttribute(n)&&USER_PROPS.has(n.name.getText(sf))&&n.initializer){
   const i=n.initializer;
   if(ts.isStringLiteral(i))flag(i,i.text);
   else if(ts.isJsxExpression(i)&&i.expression&&(ts.isStringLiteral(i.expression)||ts.isNoSubstitutionTemplateLiteral(i.expression))&&!insideT(i.expression))flag(i,i.expression.text);
  }
  else if(ts.isCallExpression(n)&&/Alert\.alert$/.test(n.expression.getText(sf)))
   for(const a of n.arguments.slice(0,2))if(ts.isStringLiteral(a)||ts.isNoSubstitutionTemplateLiteral(a))flag(a,a.text);
  else if(ts.isPropertyAssignment(n)&&/^(text|label|title|message|detail|desc|subtitle)$/.test(n.name.getText(sf))&&(ts.isStringLiteral(n.initializer)||ts.isNoSubstitutionTemplateLiteral(n.initializer))&&!insideT(n))flag(n,n.initializer.text);
  ts.forEachChild(n,visit);
 })(sf);
 return hits;
}
for(const rel of process.argv.slice(2)){
 console.log('\n== '+rel);
 for(const [line,v] of scan(path.join(root,rel)))console.log(String(line).padStart(4)+'  '+v);
}
