// Plain Node regression checks. Requires Node 22.13+ (built-in node:sqlite).
// Application modules/SQL are real; native printing captures HTML instead of making a PDF.
// Every database is a disposable temp file, removed in finally. No application edits.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {root,read,sourceFiles,location,latest,harness,ts,assert}=require('./regression-harness.cjs');
const dbPath='src/services/database/db.ts';
// Independent contract from Round 1: do NOT derive expectations from migration's array.
const MONEY={
 expenses:['amount'], bills:['subtotal','discount_amount','tax_amount','total','paid','due'],
 bill_items:['unit_price','line_total'], stock_items:['purchase_price','sale_price'],
 stock_movements:['cost_per_unit','sale_price_unit'],staff_records:['monthly_salary'],
 staff_salary_transactions:['amount'],activities:['amount'],purchase_orders:['total','received_total'],
 purchase_order_items:['unit_cost','line_total'],purchase_invoices:['subtotal','discount_amount','tax_amount','total','amount_paid','balance_due'],
 purchase_invoice_items:['unit_cost','line_total'],purchase_returns:['total_refund'],
 purchase_return_items:['unit_cost','line_total'],supplier_payments:['amount'],
};
const testCases=[];
const check=(id,name,where,fn)=>testCases.push({id,name,where,fn});
const at=(p,s)=>location(p,s);
async function isolated(fn,version=Infinity){const h=harness();try{await h.boot(version);return await fn(h);}finally{h.dispose();}}
const calc=h=>h.load('src/utils/calculations.ts');
const cash=h=>h.load('src/services/database/cashbookDb.ts');
const khata=h=>h.load('src/services/database/transactionDb.ts');
const users=h=>h.load('src/services/database/userDb.ts');
const plain=x=>JSON.parse(JSON.stringify(x));
// Money totals are ONE FIGURE PER CURRENCY since step 4. These fixtures are
// single-currency, so this unwraps the single line — and fails loudly if a total ever
// spans currencies where the test did not expect it, or if someone reverts the shape
// to a flat scalar.
const only=(totals,label='total')=>{
 assert.ok(Array.isArray(totals),label+' is not a grouped total (flat SUM?): '+JSON.stringify(totals));
 assert.equal(totals.length,1,label+' unexpectedly spans currencies: '+JSON.stringify(totals));
 return totals[0].amount;
};
const sorted=x=>[...x].sort();
const ids=rows=>sorted(rows.map(r=>r.id));
const date='2026-09-08';
function seedPeople(h){
 // account_level mirrors what the v32 backfill derives from parentId depth; every
 // real row has one after v32, so fixtures must too.
 //
 // THE TREE IS TWO LEVELS: admin -> staff. `subA` and `subB` were sub-staff before that
 // level was retired; they are now ordinary staff under the same owner. The old ids are
 // kept because ~200 assertions use them simply as "another account" for own-only tests —
 // renaming them would churn every one of those without testing anything new.
 for(const [id,role,parentId,account_level] of [['owner','admin',null,'admin'],['staffA','staff','owner','staff'],['staffB','staff','owner','staff'],['subA','staff','owner','staff'],['subB','staff','owner','staff'],['otherOwner','admin',null,'admin'],['otherStaff','staff','otherOwner','staff']])
  h.insert('users',{id,name:id,role,parentId,account_level,phone:'0300'+String(1000000+Object.keys(h.people||{}).length),businessName:'Fixture Business',passwordHash:'not-a-real-password'}),h.people={...h.people,[id]:true};
 h.login('owner');
}
async function seedEntry(h){seedPeople(h);h.login('subA');return khata(h).createTransaction('subA','Fixture customer',50000,'lena','Original',date);}
function seedLegacy(h){
 const result={};
 for(const table of Object.keys(MONEY)){
  const values={id:table+'_old'};
  for(const [i,col] of MONEY[table].entries())values[col]=12.34+i;
  h.insert(table,values);
  // Second row tests zero and nullable values, without violating NOT NULL/CHECK > 0.
  const nullable={id:table+'_nullable'};
  for(const col of MONEY[table]){
   const info=h.all('PRAGMA table_info('+table+')').find(c=>c.name===col);
   nullable[col]=info.notnull?1.25:null;
  }
  h.insert(table,nullable);
  result[table]=plain(h.all('SELECT * FROM '+table+' ORDER BY id'));
 }
 for(const table of ['transactions','cashbook']){
  h.insert(table,{id:table+'_already',amount_paisa:123456});
  result[table]=plain(h.all('SELECT * FROM '+table+' ORDER BY id'));
 }
 return result;
}
// Columns a migration is expected to POPULATE rather than preserve. Their values are
// asserted by their own dedicated test, not by the row-preservation sweep.
const BACKFILLED={users:['account_level']};
function expectMoney(h,before){
 for(const [table,rows] of Object.entries(before))for(const row of rows){
  const key=h.all('PRAGMA table_info('+table+')').find(c=>c.pk)?.name || 'id';
  const actual=h.one('SELECT * FROM '+table+' WHERE '+key+'=?',row[key]);assert.ok(actual,table+' row lost');
  for(const [col,old] of Object.entries(row)){
   if(BACKFILLED[table]?.includes(col))continue;
   const converted=MONEY[table]?.includes(col);
   const expected=converted&&old!==null?Math.round(old*100):old;
   assert.equal(actual[col],expected,table+'.'+col+' '+row.id);
   if(converted&&old!==null)assert.ok(Number.isSafeInteger(actual[col]),table+'.'+col+' must hold whole paisa');
  }
 }
}
async function report(h,type,userId='owner',startDate='2026-09-01',endDate='2026-09-30'){
 const old=h.html.length;
 await h.load('src/components/Download/pdfGenerator.ts').generateReportFile({reportType:type,userId,startDate,endDate,format:'pdf'});
 assert.equal(h.html.length,old+1,'Print API not called');return h.html.at(-1);
}
function seedReports(h){
 seedPeople(h);
 for(const who of ['owner','staffA','subA','staffB','subB','otherStaff']){
  const tag='ROW_'+who;
  h.insert('cashbook',{id:'cash_'+who,userId:who,description:tag,amount_paisa:123456,direction:who==='subA'?'out':'in',date});
  h.insert('expenses',{id:'expense_'+who,user_id:who,description:tag,amount:123456,expense_date:date});
  h.insert('bills',{id:'bill_'+who,user_id:who,party_name:tag,bill_no:101,total:123456,paid:23456,due:100000,bill_date:date});
  h.insert('stock_items',{id:'stock_'+who,user_id:who,name_en:tag,purchase_price:123456,sale_price:123456,quantity:1});
  h.insert('stock_movements',{id:'move_'+who,user_id:who,item_id:'stock_'+who,change:1,cost_per_unit:123456,sale_price_unit:123456,date});
  h.insert('staff_records',{id:'staff_'+who,user_id:who,name_en:tag,monthly_salary:123456,joining_date:date});
 }
}
check(1,'v29 converts every contracted money column; already-paisa columns unchanged',at(dbPath,'const toPaisa'),()=>isolated(async h=>{const before=seedLegacy(h);await h.boot(29);expectMoney(h,before);assert.equal(h.one('PRAGMA user_version').user_version,29);},28));
check(2,'v29 migration is exactly once across actual reopen',at(dbPath,'if (version < 29)'),()=>isolated(async h=>{seedLegacy(h);await h.boot();const before=Object.fromEntries(Object.keys(MONEY).map(t=>[t,plain(h.all('SELECT * FROM '+t+' ORDER BY id'))]));await h.boot();for(const [t,rows]of Object.entries(before))assert.deepEqual(plain(h.all('SELECT * FROM '+t+' ORDER BY id')),rows,t);},28));
check(3,'discount percentage and every quantity field survive v29 unchanged',at(dbPath,'const toPaisa'),()=>isolated(async h=>{
 const expected=[];
 for(const {name:table}of h.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")){
  const cols=h.all('PRAGMA table_info('+table+')').filter(c=>/quantity|qty|threshold|^change$|^discount_pct$/.test(c.name));
  if(!cols.length)continue;const row={id:'quantity_'+table};for(const col of cols)row[col.name]=3;
  h.insert(table,row);expected.push([table,row]);
 }
 assert.ok(expected.some(([t])=>t==='bills'));await h.boot();
 for(const [table,row]of expected){const actual=h.one('SELECT * FROM '+table+' WHERE id=?',row.id);for(const [col,value]of Object.entries(row))assert.equal(actual[col],value,table+'.'+col);}
},28));
check(4,'rupee input -> integer SQLite paisa -> Rs. 1,234.56',at('src/utils/calculations.ts','export const rupeesToPaisa'),()=>isolated(async h=>{
 seedPeople(h);const paisa=calc(h).rupeesToPaisa('1234.56');assert.equal(paisa,123456);
 // The WHOLE input must be an amount: parseFloat used to read "5000Atta" as Rs. 5,000.
 const r2p=calc(h).rupeesToPaisa;
 for(const [s,p] of [['5000',500000],[' 1,25,400 ',12540000],['0.5',50],['.5',50],['12.',1200],['150.05',15005]])assert.equal(r2p(s),p,s);
 for(const bad of ['5000Atta','12abc','1.2.3','1.234','-50','0','','.','abc','1e5','Infinity','100000000'])assert.equal(r2p(bad),null,bad);
 assert.ok(/rupeesToPaisa\(finalAmount\.toFixed\(2\)\)/.test(read('src/screens/ExpenseBook/AddExpenseModal.tsx')),'calculator results are rounded to paisa before parsing');
 const entry=await khata(h).createTransaction('owner','Roundtrip',paisa,'lena','',date);
 assert.equal(calc(h).formatCurrency((await khata(h).getTransactionById(entry.id)).amount_paisa),'Rs. 1,234.56');
}));
check(5,'paisa formatting is applied once; no nested formatCurrency calls',at('src/utils/calculations.ts','export const formatCurrency'),()=>isolated(async h=>{
 h.insert('expenses',{id:'once',amount:123456});const amount=h.one("SELECT amount FROM expenses WHERE id='once'").amount;
 assert.equal(calc(h).formatCurrency(amount),'Rs. 1,234.56');assert.notEqual(calc(h).formatCurrency(amount),'Rs. 12.35');
 const bad=[];for(const file of sourceFiles()){
  const sf=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(sf)==='formatCurrency'&&n.arguments.some(a=>ts.isCallExpression(a)&&a.expression.getText(sf)==='formatCurrency'))bad.push(file+':'+(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1));ts.forEachChild(n,visit);}visit(sf);
 }assert.equal(bad.length,0,bad.join('\n'));
}));
check(6,'global search returns Khata paisa without division',at('src/services/database/searchDb.ts','amount: t.amount_paisa'),()=>isolated(async h=>{
 const e=await seedEntry(h);await khata(h).updateTransaction(e.id,'subA',{amount_paisa:123456});
 const rows=await h.load('src/services/database/searchDb.ts').executeGlobalSearch('Fixture customer','subA'); // own-only: the author searches
 const found=rows.find(r=>r.id===e.id&&r.type==='khata');assert.ok(found);assert.equal(found.amount,123456);assert.equal(calc(h).formatCurrency(found.amount),'Rs. 1,234.56');
}));
check(7,'Khata three-argument update persists every editable field',at('src/services/database/transactionDb.ts','export const updateTransaction'),()=>isolated(async h=>{
 const e=await seedEntry(h);const changes={partyName:'Changed',amount_paisa:123456,type:'dena',notes:'New note',date:'2026-08-21'};
 await khata(h).updateTransaction(e.id,'subA',changes);const saved=await khata(h).getTransactionById(e.id);
 for(const [key,value]of Object.entries(changes))assert.equal(saved[key],value,key);
}));
check(8,'Khata clearing note binds a clean value',at('src/screens/staff/EditTransactionScreen.tsx','notes: notes.trim()'),()=>isolated(async h=>{
 const e=await seedEntry(h);await khata(h).updateTransaction(e.id,'subA',{notes:''});assert.equal((await khata(h).getTransactionById(e.id)).notes,'');
}));
check(9,'Khata edit does not change untouched date',at('src/services/database/transactionDb.ts','export const updateTransaction'),()=>isolated(async h=>{
 const e=await seedEntry(h);await khata(h).updateTransaction(e.id,'subA',{notes:'Date stays'});assert.equal((await khata(h).getTransactionById(e.id)).date,date);
}));
check(10,'Khata amount edits store integer paisa',at('src/services/database/entryAuditDb.ts','function validateField'),()=>isolated(async h=>{
 const e=await seedEntry(h);await khata(h).updateTransaction(e.id,'subA',{amount_paisa:123456});
 const row=h.one('SELECT amount_paisa,typeof(amount_paisa) AS storage FROM transactions WHERE id=?',e.id);assert.equal(row.amount_paisa,123456);assert.equal(row.storage,'integer');
 await assert.rejects(khata(h).updateTransaction(e.id,'subA',{amount_paisa:1234.56}));
}));
check(11,'v30 adds category/note without rewriting old descriptions',at(dbPath,'if (version < 30)'),()=>isolated(async h=>{
 // Current bootstrap already declares these columns; remove them ONLY in the test
 // fixture to reproduce the actual pre-v30 cashbook layout on an existing phone.
 h.sqlite.exec('ALTER TABLE cashbook DROP COLUMN category; ALTER TABLE cashbook DROP COLUMN note');
 h.insert('cashbook',{id:'oldcash',description:'old — text',amount_paisa:123456});
 await h.boot(30);const row=h.one("SELECT * FROM cashbook WHERE id='oldcash'");assert.equal(row.category,null);assert.equal(row.note,null);assert.equal(row.description,'old — text');
 assert.equal(h.one('PRAGMA user_version').user_version,30);
},29));
check(12,'cash description, category and note round-trip independently',at('src/services/database/cashbookDb.ts','export const createCashEntry'),()=>isolated(async h=>{
 seedPeople(h);const e=await cash(h).createCashEntry('owner','desc — literal',123456,'in',date,null,'Sales','note — text');
 for(const expected of [{description:'desc — literal',category:'Sales',note:'note — text'},{description:'edited — literal',category:'Other',note:'updated — note'}]){
  if(expected.category==='Other')await cash(h).updateCashEntry(e.id,'owner',expected);
  const row=await cash(h).getCashEntryById(e.id);for(const [k,v]of Object.entries(expected))assert.equal(row[k],v,k);
 }assert.equal((await cash(h).getCashEntryById(e.id)).amount_paisa,123456);
}));
check(13,'cash attachment can be set then cleared to NULL',at('src/services/database/cashbookDb.ts','export const updateCashEntry'),()=>isolated(async h=>{
 seedPeople(h);const e=await cash(h).createCashEntry('owner','receipt',123456,'in',date,'file://receipt.jpg');
 assert.equal((await cash(h).getCashEntryById(e.id)).attachment_url,'file://receipt.jpg');
 await cash(h).updateCashEntry(e.id,'owner',{attachment_url:null});assert.equal((await cash(h).getCashEntryById(e.id)).attachment_url,null);
}));
check(14,'cash create accepts 4–8 args; update rejects fields outside its accepted type',at('src/services/database/cashbookDb.ts','export const updateCashEntry'),()=>isolated(async h=>{
 seedPeople(h);const e=await cash(h).createCashEntry('owner','four args',100,'in');assert.ok(await cash(h).getCashEntryById(e.id));
 const full=await cash(h).createCashEntry('owner','eight args',123456,'out',date,null,'Sales','Note');assert.equal((await cash(h).getCashEntryById(full.id)).note,'Note');
 await assert.rejects(cash(h).updateCashEntry(e.id,'owner',{not_a_column:1}));
 // An existing DB column outside Partial<Pick<...>> must also be rejected, not just
 // a made-up column that SQLite happens to reject. This exercises the real runtime.
 await assert.rejects(cash(h).updateCashEntry(e.id,'owner',{userId:'staffB'}),'updateCashEntry accepted userId, outside its public updates type');
 // Exercise all affected APIs against actual SQLite. Invalid payloads must neither
 // alter a row nor enqueue a write, even when mixed with a valid field.
 const billId=h.insert('bills',{user_id:'owner'});
 const itemId=h.insert('bill_items',{bill_id:billId});
 const supplierId=h.insert('suppliers',{user_id:'owner'});
 const customerId=h.insert('customers',{user_id:'owner'});
 const tx=await khata(h).createTransaction('owner','Owner entry',100,'lena','',date);
 const billApi=h.load('src/services/database/billDb.ts');
 const cases=[
  ['cashbook',e.id,p=>cash(h).updateCashEntry(e.id,'owner',p),{description:'Allowed'}],
  ['bills',billId,p=>billApi.updateBill(billId,'owner',p),{party_name:'Allowed'}],
  ['bill_items',itemId,p=>billApi.updateBillItem(itemId,billId,'owner',p),{item_name:'Allowed'}],
  ['suppliers',supplierId,p=>h.load('src/services/database/supplierDb.ts').updateSupplier(supplierId,'owner',p),{name:'Allowed'}],
  ['customers',customerId,p=>h.load('src/services/database/customerDb.ts').updateCustomer(customerId,'owner',p),{name:'Allowed'}],
  ['transactions',tx.id,p=>khata(h).updateTransaction(tx.id,'owner',p),{notes:'Allowed'}],
 ];
 for(const [table,id,update,valid]of cases){
  const before=plain(h.one('SELECT * FROM '+table+' WHERE id=?',id));
  const pending=h.one('SELECT COUNT(*) AS n FROM sync_queue').n;
  for(const field of ['id','userId','user_id','bill_id','synced','syncStatus','isDeleted','is_deleted','deletedAt','deleted_at','firestore_path','skip_sync','unexpected']){
   await assert.rejects(update({...valid,[field]:'forbidden'}),/cannot be changed/,table+'.'+field);
  }
  assert.deepEqual(plain(h.one('SELECT * FROM '+table+' WHERE id=?',id)),before,table+' was modified');
  assert.equal(h.one('SELECT COUNT(*) AS n FROM sync_queue').n,pending,table+' enqueued rejected update');
  await update(valid);
  const saved=h.one('SELECT * FROM '+table+' WHERE id=?',id);for(const [field,value]of Object.entries(valid))assert.equal(saved[field],value,table+'.'+field);
 }

}));
const pdf='src/components/Download/pdfGenerator.ts';
// Books converted to OWN-ONLY (every account sees only the rows it created; others are
// reachable only through the Staff Book drill-down). Each book joins as it is converted.
const OWN_ONLY=new Set(['cash','expense','bill','stock','khata','customer','purchase','staff']);
const bookScope=(type,who,tree)=>OWN_ONLY.has(type)?(tree.includes(who)?[who]:[]):tree; // a viewer with no seeded rows of their own gets none
check(15,'PDF header query uses real user/business fields',at(pdf,'SELECT name, businessName'),()=>isolated(async h=>{seedReports(h);const html=await report(h,'bill');assert.ok(html.includes('Fixture Business'));assert.ok(!/{{\w+}}/.test(html));}));
check(16,'cash report direction produces IN/OUT and correct totals',at(pdf,"if (options.reportType === 'cash')"),()=>isolated(async h=>{
 seedReports(h);const html=await report(h,'cash','staffA');assert.ok(html.includes('>In<'));assert.ok(!html.includes('>Out<'),'own-only: the sub-staff OUT row is not in staffA\'s cash');assert.ok(html.includes('Rs. 1,234.56'));assert.ok(html.includes('Rs. 0'));
 const sub=await report(h,'cash','subA');assert.ok(sub.includes('>Out<'));assert.ok(!sub.includes('>In<'));assert.ok(sub.includes('ROW_subA')&&!sub.includes('ROW_staffA'));
}));
check(17,'all five report branches produce HTML rows from stored data',at(pdf,'export const generateReportFile'),()=>isolated(async h=>{
 seedReports(h);for(const type of ['cash','expense','stock','bill','staff']){
  const html=await report(h,type,'staffA');assert.match(html,/<html[\s>]/i,type);assert.ok(html.includes('ROW_staffA'),type);assert.equal(html.includes('ROW_subA'),!OWN_ONLY.has(type),type+(OWN_ONLY.has(type)?' is own-only':' still team-wide'));assert.match(html,/<tr>/i);
 }
}));
check(18,'every PDF branch formats paisa once without doubled currency prefix',at(pdf,'export const generateReportFile'),()=>isolated(async h=>{
 seedReports(h);for(const type of ['cash','expense','stock','bill','staff']){
  const html=await report(h,type);assert.ok(html.includes('Rs. 1,234.56'),type+' missing formatted money');assert.ok(!html.includes('123456'),type+' raw paisa');assert.ok(!/Rs\.?\s+Rs\./.test(html),type+' doubled prefix');
  assert.ok(!html.includes('Rs. 12.35'),type+' divided twice');
 }
}));
check(19,'empty reports contain the appropriate no-records document',at(pdf,'No staff records'),()=>isolated(async h=>{
 seedPeople(h);const failures=[];for(const type of ['cash','expense','stock','bill','staff']){
  const html=await report(h,type);const expected=type==='staff'?'No staff records':'No records for this period';
  if(!/<html[\s>]/i.test(html)||!html.includes(expected))failures.push(type+': missing '+expected);
 }assert.equal(failures.length,0,failures.join('; '));
}));
check(20,'PDF row sets match real book queries for each hierarchy branch',at(pdf,"hierarchyFilter('si.user_id')"),()=>isolated(async h=>{
 seedReports(h);
 // A parent-owned item moved by their sub-staff is a legitimate hierarchy case.
 h.insert('stock_items',{id:'cross',user_id:'staffA',name_en:'ROW_cross',purchase_price:123456,sale_price:123456,quantity:1});
 h.insert('stock_movements',{id:'crossmove',item_id:'cross',user_id:'subA',change:1,cost_per_unit:123456,date});
 h.insert('stock_items',{id:'removedstock',user_id:'staffA',name_en:'ROW_removed',purchase_price:123456,sale_price:123456,quantity:1,is_deleted:1});
 h.insert('stock_movements',{id:'removedmove',item_id:'removedstock',user_id:'staffA',change:1,cost_per_unit:123456,date});
 const failures=[];
 for(const who of ['owner','staffA','subA','staffB','otherOwner'])for(const type of ['cash','expense','stock','bill','staff']){
  let rows,field;
  if(type==='cash'){rows=await cash(h).getCashEntriesByUserId(who,1000);field='description';}
  if(type==='expense'){rows=await h.load('src/services/database/expenseDb.ts').getExpensesByUserId(who,1000);field='description';}
  if(type==='bill'){rows=await h.load('src/services/database/billDb.ts').getBillsByUserId(who,'2026-09-01','2026-09-30');field='party_name';}
  if(type==='staff'){rows=await h.load('src/services/database/staffDb.ts').getStaffRecords(who);field='name_en';}
  if(type==='stock'){const api=h.load('src/services/database/stockDb.ts');rows=[...await api.getStockInReport(who,'2026-09-01','2026-09-30'),...await api.getStockOutReport(who,'2026-09-01','2026-09-30')];field='item_name_en';}
  const expected=sorted(new Set(rows.map(r=>r[field])));const html=await report(h,type,who);const actual=sorted(new Set(html.match(/ROW_[A-Za-z]+/g)||[]));
  if(JSON.stringify(expected)!==JSON.stringify(actual))failures.push(type+'/'+who+': expected '+expected.join(',')+'; got '+actual.join(','));
 }assert.equal(failures.length,0,failures.join('\n'));
}));
check(21,'calculator full valid-expression table',at('src/utils/safeCalc.ts','export function evaluateExpression'),()=>isolated(async h=>{
 const evaluate=h.load('src/utils/safeCalc.ts').evaluateExpression;
 for(const [input,expected]of [['12+5',17],['2+3*4',14],['100/3',33.3333333333],['0.1+0.2',0.3],['-5',-5],['5×-3',-15],['.5+.5',1],['1+2+3+4',10],['12++5',17]]){
  const result=evaluate(input);assert.equal(result.ok,true,input);assert.equal(result.value,expected,input);
 }
}));
check(22,'invalid calculator expressions return failures, never numbers',at('src/utils/safeCalc.ts','export function evaluateExpression'),()=>isolated(async h=>{
 const evaluate=h.load('src/utils/safeCalc.ts').evaluateExpression;
 for(const input of ['12+','5/0','','5M+3','5//2']){const result=evaluate(input);assert.equal(result.ok,false,input);assert.equal(typeof result.error,'string');assert.equal('value'in result,false,input);}
}));
check(23,'no executable eval or Function constructor in project source','source scan (comments/documentation ignored)',async()=>{
 const hits=[];
 for(const file of sourceFiles()){
  const sf=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  function visit(n){
   if(ts.isCallExpression(n)||ts.isNewExpression(n)){
    const target=n.expression.getText(sf);
    if(/\b(eval|Function)\b/.test(target))hits.push(path.relative(root,file)+':'+(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1)+' '+target);
   }ts.forEachChild(n,visit);
  }visit(sf);
 }assert.equal(hits.length,0,hits.join('\n'));
});
check(24,'deleteUser removed; deactivateUser retains the user with soft-delete markers',at('src/services/database/userDb.ts','export const deactivateUser'),()=>isolated(async h=>{
 seedPeople(h);assert.equal(users(h).deleteUser,undefined);await users(h).deactivateUser('subA');const row=h.one("SELECT * FROM users WHERE id='subA'");assert.ok(row);assert.equal(row.is_deleted,1);assert.ok(row.deleted_at);
}));
check(25,'removing a staff member never changes anyone else\'s figures',at('src/services/database/userDb.ts','export const deactivateUser'),()=>isolated(async h=>{
 seedPeople(h);
 // Everyone has some work of their own, including the person about to be removed.
 const people=['owner','staffA','staffB','subB','otherOwner','otherStaff'];
 for(const who of [...people,'subA']){
  await khata(h).createTransaction(who,'History '+who,50000,'lena','',date);
  await cash(h).createCashEntry(who,'History '+who,30000,'in',date);
 }
 const snapshot=async()=>{const out={};for(const id of people)out[id]={
  tx:ids(await khata(h).getTransactionsByUserId(id)),
  cash:ids(await cash(h).getCashEntriesByUserId(id)),
  txTotal:plain(await khata(h).getBalanceSummary(id)),
  cashTotal:plain(await cash(h).getCashBalanceSummary(id)),
 };return out;};

 const before=await snapshot();
 await users(h).deactivateUser('subA');
 assert.deepEqual(await snapshot(),before,'nobody else\'s rows or totals moved');

 // The removed person\'s own rows are kept, not deleted — their history stays readable
 // through the drill-down (checks 44/48 cover that path).
 assert.equal(h.one("SELECT COUNT(*) AS n FROM transactions WHERE userId='subA' AND isDeleted=0").n,1,'their entries are kept');
 assert.equal(h.one("SELECT is_deleted FROM users WHERE id='subA'").is_deleted,1,'the login is soft-deleted, never dropped');
}));
check(26,'correct password works before removal and fails after removal',at('src/services/database/userDb.ts','export const verifyUserLogin'),()=>isolated(async h=>{
 seedPeople(h);const api=users(h);const hash=await api.hashPassword('FixturePass1');h.sqlite.prepare("UPDATE users SET passwordHash=?,phone=? WHERE id='subA'").run(hash,'03101111111');
 assert.equal((await api.verifyUserLogin('03101111111','FixturePass1')).id,'subA');await api.deactivateUser('subA');assert.equal(await api.verifyUserLogin('03101111111','FixturePass1'),null);
}));
check(27,'people lists stay within their owner/staff branch',at('src/services/database/userDb.ts','export const getUsersInScope'),()=>isolated(async h=>{
 seedPeople(h);
 // Two levels: nothing sits below a staff member, so their people list is empty.
 assert.deepEqual(ids(await users(h).getUsersInScope('staffA')),[]);assert.deepEqual(ids(await users(h).getUsersInScope('staffB')),[]);
 assert.deepEqual(ids(await users(h).getUsersInScope('owner')),sorted(['staffA','staffB','subA','subB']));assert.deepEqual(ids(await users(h).getUsersInScope('otherOwner')),['otherStaff']);
}));
check(28,'hierarchy parent subqueries never filter out removed users','src/services/database/queryHelpers.ts and inline source SQL',async()=>{
 const hits=[];let examined=0;
 for(const file of sourceFiles()){
  const text=fs.readFileSync(file,'utf8');
  // Balanced parentheses isolate the inner SELECT (not the outer entry filter,
  // where is_deleted=0 is correct). Comments have no SQL effect.
  const re=/SELECT\s+(?:\w+\.)?id\s+FROM\s+users\s+WHERE\s+parentId\b/gi;let m;
  while((m=re.exec(text))){examined++;let depth=0,end=m.index;
   for(;end<text.length;end++){if(text[end]==='(')depth++;if(text[end]===')'){if(depth===0)break;depth--;}}
   if(/\bis_deleted\b/.test(text.slice(m.index,end)))hits.push(path.relative(root,file)+':'+text.slice(0,m.index).split('\n').length);
  }
 }assert.ok(examined>=20,'Expected to examine all hierarchy copies; found '+examined); // books are own-only now; the Staff Book, monitoring and report copies remainassert.equal(hits.length,0,hits.join('\n'));
});
check(29,'empty -> latest and populated v28 -> latest migration chains preserve rows',at(dbPath,'let version ='),async()=>{
 await isolated(async h=>{assert.equal(h.one('PRAGMA user_version').user_version,latest);assert.deepEqual(h.versions,Array.from({length:latest},(_,i)=>i+1));});
 await isolated(async h=>{
  const before=seedLegacy(h);const tables=h.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r=>r.name);
  // Seed non-money business tables too. Queue/metadata are operational, not entries.
  for(const table of tables)if(!before[table]&&!['sync_queue','sync_metadata'].includes(table)){h.insert(table);before[table]=plain(h.all('SELECT * FROM '+table+' ORDER BY '+(h.all('PRAGMA table_info('+table+')').some(c=>c.name==='id')?'id':'rowid')));}
  for(const v of [29,30,latest]){await h.boot(v);expectMoney(h,before);assert.equal(h.one('PRAGMA user_version').user_version,v);}
  const counts=Object.fromEntries(tables.map(t=>[t,h.one('SELECT COUNT(*) AS n FROM '+t).n]));await h.boot();for(const [t,n]of Object.entries(counts))assert.equal(h.one('SELECT COUNT(*) AS n FROM '+t).n,n,t);
 },28);
});
check(30,'no imports of deleted expense module or removed user APIs','project-wide import scan',async()=>{
 const hits=[];for(const file of sourceFiles()){
  const text=fs.readFileSync(file,'utf8');const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  function visit(n){
   if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n)){
    const spec=n.moduleSpecifier?.text;
    const resolved=spec?.startsWith('.')?path.resolve(path.dirname(file),spec).replace(/\\/g,'/'):spec;
    const removed=resolved&&/(?:^|\/)src\/db\/expenseDb(?:\.ts)?$/.test(resolved);
    const imported=n.importClause?.namedBindings||n.exportClause;
    if(removed||(imported&&/\b(deleteUser|getAllUsers)\b/.test(imported.getText(sf))))hits.push(path.relative(root,file)+':'+(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1));
   }
   if(ts.isCallExpression(n)&&n.arguments.length&&ts.isStringLiteral(n.arguments[0])&&/^(require|import)$/.test(n.expression.getText(sf))){
    const spec=n.arguments[0].text;const resolved=path.resolve(path.dirname(file),spec).replace(/\\/g,'/');
    if(/\/src\/db\/expenseDb(?:\.ts)?$/.test(resolved)||/\b(deleteUser|getAllUsers)\b/.test(n.parent.getText(sf)))hits.push(path.relative(root,file)+':'+(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1));
   }ts.forEachChild(n,visit);
  }visit(sf);
 }assert.equal(hits.length,0,hits.join('\n'));
});

check(31,'account creation is two levels: only an owner creates logins, every login is a staff member directly under them, and nothing can be created below staff','src/services/database/managedAccountDb.ts',()=>isolated(async h=>{
 seedPeople(h);const api=h.load('src/services/database/managedAccountDb.ts');
 const make=(phone,extra={})=>api.createManagedAccount({name:'Managed '+phone,phone,password:'FixturePass1',...extra});
 const count=()=>h.one('SELECT COUNT(*) AS n FROM users').n;

 // An owner creates a staff login, directly under themselves. There is no level to choose.
 h.login('owner');const staff=await make('03101112222');
 assert.equal(staff.role,'staff');assert.equal(staff.parentId,'owner');
 assert.equal(h.one('SELECT account_level AS l FROM users WHERE id=?',staff.id).l,'staff');
 assert.equal(h.one('SELECT is_deleted FROM users WHERE id=?',staff.id).is_deleted,0);
 assert.equal((await users(h).verifyUserLogin('03101112222','FixturePass1')).id,staff.id);

 // NOTHING can be created below a staff member. The data layer refuses the level outright,
 // so even a direct createUser cannot make one.
 await assert.rejects(users(h).createUser('Deeper','03101112223','FixturePass1','staff','substaff','Biz',staff.id),/Sub-staff no longer have logins/);
 h.login(staff.id);
 assert.equal(h.one('SELECT COUNT(*) AS n FROM users WHERE parentId=?',staff.id).n,0,'a staff member has nobody below them');
 await assert.rejects(make('03101112224'),/Only the owner/,'a staff member cannot create a login');
 // They may still ADD to the Staff Book — as a record with no login (step c).
 assert.equal(await api.canCreateStaff(),true,'a staff member may add a sub-staff record');

 h.login('owner');assert.equal(await api.canCreateStaff(),true,'so may the owner');

 // Strength, and a rejected account leaves nothing behind.
 const before=count();
 for(const password of ['Abc1','abcdefgh','Abcdefgh'])await assert.rejects(api.createManagedAccount({name:'Weak',phone:'03101112225',password}),/Password must/);
 assert.equal(count(),before,'a rejected account was never inserted');

 // A removed or missing actor cannot create anyone.
 await users(h).deactivateUser(staff.id);
 h.login(staff.id);await assert.rejects(make('03101112225'),/no longer/);
 h.login('missing');await assert.rejects(make('03101112225'),/no longer/);
 assert.equal(count(),before,'still nothing inserted');

 // The level is never taken from the payload: a caller cannot smuggle one in.
 h.login('owner');
 const smuggled=await api.createManagedAccount({name:'Smuggled',phone:'03101112226',password:'FixturePass1',role:'admin',accountType:'substaff',parentStaffId:'staffB'});
 assert.equal(smuggled.role,'staff');assert.equal(smuggled.parentId,'owner','ownership comes from the actor, never the payload');
 assert.equal(h.one('SELECT account_level AS l FROM users WHERE id=?',smuggled.id).l,'staff');
}));

check(32,'public registration screen, route, store action and imports are absent','public signup removal',async()=>{
 assert.equal(fs.existsSync(path.join(root,'src/screens/auth/RegisterScreen.tsx')),false);
 assert.ok(!/\bregister\s*:/.test(read('src/store/authStore.ts')));
 assert.ok(!/Register|registerBtn|registerHint/.test(read('src/screens/auth/LoginScreen.tsx')));
 assert.ok(!/Register/.test(read('src/navigation/AuthNavigator.tsx')));
 for(const file of sourceFiles())assert.ok(!/RegisterScreen/.test(fs.readFileSync(file,'utf8')),file+' references removed screen');
 const callers=sourceFiles().filter(file=>/\bcreateUser\s*\(/.test(fs.readFileSync(file,'utf8'))).map(file=>path.relative(root,file).replace(/\\/g,'/'));
 assert.deepEqual(sorted(callers),sorted(['src/services/database/seedData.ts','src/services/database/managedAccountDb.ts']));
});

// ── v32: explicit account_level ───────────────────────────────────────────────
// Visibility must be identical before and after v32. account_level is for role
// checks only; scoping still flows through parentId via userScope().
const SCOPED={transactions:'userId',cashbook:'userId',expenses:'user_id',bills:'user_id',stock_items:'user_id'};
const scopeSql=col=>'('+col+' = ? OR '+col+' IN (SELECT id FROM users WHERE parentId = ?) OR '+col+' IN (SELECT id FROM users WHERE parentId IN (SELECT id FROM users WHERE parentId = ?)))';
function scopeSnapshot(h){
 const out={};
 for(const viewer of ['owner','staffA','staffB','subA','subB','otherOwner','otherStaff'])
  for(const [table,col] of Object.entries(SCOPED))
   out[viewer+'/'+table]=ids(h.all('SELECT id FROM '+table+' WHERE '+scopeSql(col),viewer,viewer,viewer));
 return out;
}
function seedScopedEntries(h){
 for(const who of ['owner','staffA','staffB','subA','subB','otherOwner','otherStaff']){
  h.insert('transactions',{id:'t_'+who,userId:who,partyName:'P',amount_paisa:1000,type:'lena',date});
  h.insert('cashbook',{id:'c_'+who,userId:who,description:'D',amount_paisa:1000,direction:'in',date});
  h.insert('expenses',{id:'e_'+who,user_id:who,description:'D',amount:1000,expense_date:date});
  h.insert('bills',{id:'b_'+who,user_id:who,party_name:'P',bill_date:date,subtotal:1000,total:1000,due:0,status:'paid'});
  h.insert('stock_items',{id:'s_'+who,user_id:who,name_en:'Item',category:'C',unit:'pc',purchase_price:1000,sale_price:1500,low_stock_threshold:1});
 }
}
const levelOf=(h,id)=>h.one('SELECT account_level FROM users WHERE id=?',id)?.account_level;

check(33,'v32 backfill classifies every level and never promotes an edge case',at(dbPath,'v32 account_level backfill'),()=>isolated(async h=>{
 // Raw rows with NO account_level: the migration must derive all of them.
 const people=[['owner','admin',null],['staffA','staff','owner'],['subA','staff','staffA'],
  ['rootStaff','staff',null],            // edge 1: legacy self-registration
  ['orphan','staff','ghost-user'],       // edge 3: parent row removed by the old hard delete
  ['deep1','staff','subA'],              // edge 4: chain deeper than the 3-level model
  ['cycA','staff','cycB'],['cycB','staff','cycA']]; // edge 5: cycle
 for(const [id,role,parentId] of people)
  h.insert('users',{id,name:id,role,parentId,phone:'0311'+id,businessName:'B',passwordHash:'x'});
 for(const [id] of people)assert.equal(levelOf(h,id),null,id+' fixture must start unclassified');

 await h.boot();
 assert.equal(h.one('PRAGMA user_version').user_version,latest);
 assert.deepEqual(Object.fromEntries(people.map(([id])=>[id,levelOf(h,id)])),{
  owner:'admin',staffA:'staff',subA:'substaff',
  rootStaff:'staff',      // NULL parent stays top-level — matches today's permissions
  orphan:'substaff',      // dangling parent is NEVER promoted
  deep1:'substaff',cycA:'substaff',cycB:'substaff',
 });
 assert.equal(h.one("SELECT COUNT(*) AS n FROM users WHERE account_level IS NULL").n,0);
},31));

check(34,'v32 leaves every scoped result byte-identical for owner, staff and sub-staff',at('src/services/database/queryHelpers.ts','userScope'),()=>isolated(async h=>{
 seedPeople(h);seedScopedEntries(h);
 assert.equal(h.one('PRAGMA user_version').user_version,31);
 const before=scopeSnapshot(h);
 assert.ok(Object.values(before).some(v=>v.length),'snapshot must contain rows');
 await h.boot();
 assert.equal(h.one('PRAGMA user_version').user_version,latest);
 assert.deepEqual(scopeSnapshot(h),before,'v32 changed what somebody can see');
 // The scoping helper itself must be untouched by this migration.
 assert.ok(read('src/services/database/queryHelpers.ts').includes("(${col} = ? OR ${col} IN (SELECT id FROM users WHERE parentId = ?))"));
 // The parentId-walking SUBQUERY is the scoping chain; it must stay purely structural.
 // Selecting account_level as a display column elsewhere in the same statement is fine —
 // what must never happen is account_level entering the predicate that decides visibility.
 for(const file of sourceFiles())for(const subquery of fs.readFileSync(file,'utf8').match(/SELECT id FROM users WHERE parentId[^)]*/g)||[])
  assert.ok(!/account_level/.test(subquery),'account_level must never appear in a scoping chain: '+file+' -> '+subquery.replace(/\s+/g,' ').slice(0,120));
},31));

check(35,'each creation path stores the right level and inconsistent combinations are rejected','src/services/database/managedAccountDb.ts',()=>isolated(async h=>{
 seedPeople(h);const api=h.load('src/services/database/managedAccountDb.ts');
 h.login('owner');
 const staff=await api.createManagedAccount({name:'S',phone:'03201110001',password:'FixturePass1'});
 assert.equal(levelOf(h,staff.id),'staff');assert.equal(staff.parentId,'owner');
 // Every login an owner creates is a staff member under them — there is no other outcome.
 const second=await api.createManagedAccount({name:'S2',phone:'03201110002',password:'FixturePass1'});
 assert.equal(levelOf(h,second.id),'staff');assert.equal(second.parentId,'owner');
 // Inconsistent role/level/parent combinations throw rather than being corrected.
 const mk=h.load('src/services/database/userDb.ts').createUser;
 const before=h.one('SELECT COUNT(*) AS n FROM users').n;
 await assert.rejects(mk('X','03201110004','FixturePass1','admin','admin','B','owner'),/cannot have a parent/);
 await assert.rejects(mk('X','03201110004','FixturePass1','staff','admin','B'),/requires role "admin"/);
 await assert.rejects(mk('X','03201110004','FixturePass1','admin','staff','B','owner'),/requires role "staff"/);
 await assert.rejects(mk('X','03201110004','FixturePass1','staff','staff','B',staff.id),/directly under an admin/);
 // The retired level is refused outright, with or without a parent.
 await assert.rejects(mk('X','03201110004','FixturePass1','staff','substaff','B','owner'),/Sub-staff no longer have logins/);
 await assert.rejects(mk('X','03201110004','FixturePass1','staff','substaff','B'),/Sub-staff no longer have logins/);
 await assert.rejects(mk('X','03201110004','FixturePass1','staff','staff','B','ghost'),/Parent account not found/);
 assert.equal(h.one('SELECT COUNT(*) AS n FROM users').n,before,'a rejected account was still inserted');
}));

check(36,'user scope: the owner sees their whole tree with each person\'s explicit level and parent; a staff member sees only their own branch',at('src/services/database/userDb.ts','getUsersInScope'),()=>isolated(async h=>{
 seedPeople(h);
 const scoped=await users(h).getUsersInScope('owner');
 const by=Object.fromEntries(scoped.map(u=>[u.id,u]));
 assert.deepEqual(ids(scoped),['staffA','staffB','subA','subB'],'owner sees their whole team, and nobody else');
 // Two levels: every one of them is a staff member directly under the owner.
 for(const id of ['staffA','staffB','subA','subB']){
  assert.equal(by[id].account_level,'staff',id+' is staff level');
  assert.equal(by[id].parentName,'owner',id+' reports to the owner');
 }
 // A staff member has nobody below them, so their list is empty.
 assert.deepEqual(ids(await users(h).getUsersInScope('staffA')),[]);
 // Home deliberately carries no staff list (the owner's decision, 2026-09-23): the team
 // lives in the Staff Book, and each person's books open from there — read-only.
 assert.ok(!/getUsersInScope/.test(read('src/screens/admin/AdminDashboard.tsx')),'home stays a books screen');
}));

// ── Dates: local calendar day, and no hand-typed date entry ───────────────────
// The PKT assertions must run under a real UTC+5 timezone, so they execute in a
// child process with TZ=Asia/Karachi rather than mutating this process's clock.
const inKarachi=script=>require('node:child_process').execFileSync(
 process.execPath,['-e',script],
 {env:{...process.env,TZ:'Asia/Karachi'},encoding:'utf8',cwd:root}
).trim();

check(37,'today is the LOCAL calendar day, not the UTC one',at('src/utils/dates.ts','localDate'),()=>{
 const out=inKarachi(`
  const assert=require('node:assert/strict');
  const ts=require('typescript');
  const fs=require('node:fs');
  const src=ts.transpileModule(fs.readFileSync('src/utils/dates.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const m={exports:{}};new Function('exports','module','require',src)(m.exports,m,require);
  assert.equal(new Date().getTimezoneOffset(),-300,'child must run at UTC+5');
  // 00:30 local on 10 Sep is 19:30 UTC on 9 Sep — the exact window that was wrong.
  const justAfterMidnight=new Date(2026,8,10,0,30,0);
  assert.equal(m.exports.localDate(justAfterMidnight),'2026-09-10');
  assert.equal(justAfterMidnight.toISOString().split('T')[0],'2026-09-09','fixture must reproduce the UTC skew');
  assert.equal(m.exports.localDate(new Date(2026,8,10,23,59,0)),'2026-09-10');
  // Round-trip and tolerance
  assert.equal(m.exports.toDateValue('2026-09-10T18:00:00.000Z'),'2026-09-10','legacy timestamp keeps its local day');
  assert.equal(m.exports.toDateValue('2026-99-99'),null);
  assert.equal(m.exports.isValidDateValue('2026-02-30'),false,'rolled-over dates must be rejected');
  assert.equal(m.exports.isValidDateValue('2026-02-28'),true);
  console.log('OK');`);
 assert.equal(out,'OK');
});

check(38,'an entry saved just after local midnight is in TODAY\'s Day Book',at('src/services/database/cashbookDb.ts','getTodayCashEntries'),()=>{
 const out=inKarachi(`
  const assert=require('node:assert/strict');
  const {harness}=require('./tests/regression-harness.cjs');
  (async()=>{
   assert.equal(new Date().getTimezoneOffset(),-300,'child must run at UTC+5');
   const h=harness();
   try{
    await h.boot();
    h.insert('users',{id:'owner',name:'owner',role:'admin',parentId:null,account_level:'admin',phone:'03001',businessName:'B',passwordHash:'x'});
    h.login('owner');
    const cash=h.load('src/services/database/cashbookDb.ts');
    const dates=h.load('src/utils/dates.ts');
    // Save with the screen default — i.e. whatever the app calls "today".
    await cash.createCashEntry('owner','Midnight sale',50000,'in',dates.todayDate());
    const today=await cash.getDayBook('owner',dates.todayDate());
    assert.equal(today.entries.length,1,'entry saved today must appear in today Day Book');
    assert.equal(today.entries[0].date,dates.todayDate());
    assert.equal(today.dayTotals.cashIn,50000);
    // …and must NOT leak into the previous day.
    const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
    const prev=await cash.getDayBook('owner',dates.localDate(yesterday));
    assert.equal(prev.entries.length,0,'new day entry must not appear in the previous day');
    assert.equal(prev.dayTotals.cashIn,0);
    // Cash in Hand and the Day Book must agree about the same entry.
    const summary=await cash.getCashBalanceSummary('owner');
    assert.equal(summary.cashIn,50000);
   } finally { h.dispose(); }
   console.log('OK');
  })().catch(e=>{console.error(e.message);process.exit(1);});`);
 assert.equal(out,'OK');
});

check(39,'reads tolerate legacy malformed and timestamp dates without crashing',at('src/utils/calculations.ts','formatDate'),()=>isolated(async h=>{
 const {formatDate}=calc(h);
 assert.equal(formatDate('2026-99-99'),'2026-99-99','malformed value shown as-is, never "Invalid Date"');
 assert.equal(formatDate(''),'—');
 assert.ok(/2026/.test(formatDate('2026-09-10')));
 assert.ok(/2026/.test(formatDate('2026-09-10T18:00:00.000Z')),'legacy timestamp still renders');
 // A legacy row with a broken date must not break the book that lists it.
 seedPeople(h);
 h.insert('transactions',{id:'legacy_bad',userId:'owner',partyName:'P',amount_paisa:1000,type:'lena',date:'2026-99-99'});
 h.insert('transactions',{id:'legacy_ts',userId:'owner',partyName:'P',amount_paisa:1000,type:'lena',date:'2026-09-10T18:00:00.000Z'});
 const rows=await khata(h).getTransactionsByUserId('owner',50,0);
 assert.ok(rows.length>=2);
 for(const r of rows)assert.equal(typeof formatDate(r.date),'string');
}));

check(40,'no hand-typed date entry remains, and every date column is written YYYY-MM-DD','date picker rollout',()=>{
 const live=sourceFiles().filter(p=>!/CashInModal|CashOutModal/.test(p));
 for(const file of live){
  const text=fs.readFileSync(file,'utf8');
  assert.ok(!/placeholder="YYYY-MM-DD"/.test(text),'hand-typed date input still present: '+file);
  assert.ok(!/\b(date|due_date|bill_date|expense_date|payment_date|joining_date|order_date|invoice_date|return_date|expected_date)\s*:\s*[^,\n]*toISOString\(\)\s*[,\n]/.test(text),
   'a date column is still written as a full timestamp: '+file);
 }
 // Every date surface goes through the ONE shared component. Asserted as a named set
 // rather than a count, so adding a date field is a deliberate, visible change here.
 const users=sorted(live.filter(p=>/<DateField/.test(fs.readFileSync(p,'utf8')))
  .map(p=>path.relative(root,p).replace(/\\/g,'/')));
 assert.deepEqual(users,sorted([
  'src/components/ui/DateRangeFilter.tsx',          // the shared from–to control
  'src/screens/BillBook/CreateNewBillModal.tsx',
  'src/screens/CashBook/CashBookScreen.tsx',        // day navigator (Prompt 13)
  'src/screens/CashBook/CashEntryModal.tsx',
  'src/screens/ExpenseBook/AddExpenseModal.tsx',
  'src/screens/ExpenseBook/ExpenseBookScreen.tsx', // day navigator's jump picker

  'src/screens/PurchaseBook/CreatePurchaseInvoiceModal.tsx',
  'src/screens/PurchaseBook/CreatePurchaseOrderModal.tsx',
  'src/screens/PurchaseBook/PurchaseReturnModal.tsx',
  'src/screens/StaffBook/AddStaffModal.tsx',
  'src/screens/StaffBook/StaffDetail.tsx',           // Edit profile → joining date
  'src/screens/StaffBook/StaffSalaryDetailScreen.tsx',
  'src/screens/StockBook/AddSupplierPaymentModal.tsx',
  'src/screens/StockBook/StockItemDetailScreen.tsx',
  'src/screens/reminders/AddReminderScreen.tsx',
  'src/screens/staff/AddTransactionScreen.tsx',
  'src/screens/staff/EditTransactionScreen.tsx',
 ]));
 assert.ok(/react-native-community\/datetimepicker/.test(read('src/components/ui/DateField.tsx')));
 // todayDate must be local everywhere; no UTC derivation outside the dead files.
 for(const file of live)assert.ok(!/toISOString\(\)\.split\('T'\)\[0\]/.test(fs.readFileSync(file,'utf8').replace(/^\s*\*.*$/gm,'')),
  'UTC date derivation still present: '+file);
});

function seedKhataRange(h) {
 seedPeople(h);
 const rows=[];
 for(const who of ['owner','staffA','subA','staffB','subB','otherOwner','otherStaff']) {
  for(let i=0;i<200;i++) {
   const row={id:`range_${who}_${i}`,userId:who,partyName:i%2?'Other':'Needle customer',
    notes:i%2?'needle note':null,amount_paisa:10001+i,type:i%3?'lena':'dena',
    date:i===0?'2026-08-31':i===199?'2026-10-01':i===1?'2026-09-01':'2026-09-30',isDeleted:i===2?1:0};
   h.insert('transactions',row);rows.push(row);
  }
 }
 return rows;
}
const expectedKhata=(rows,scope,f)=>rows.filter(r=>scope.includes(r.userId)&&!r.isDeleted&&
 (!f.startDate||r.date>=f.startDate)&&(!f.endDate||r.date<=f.endDate)&&
 (!f.type||f.type==='all'||r.type===f.type)&&
 (!f.search||(r.partyName+' '+(r.notes||'')).toLowerCase().includes(f.search.toLowerCase())));
function assertKhataSummary(actual,rows) {
 const lena=rows.filter(r=>r.type==='lena').reduce((s,r)=>s+r.amount_paisa,0);
 const dena=rows.filter(r=>r.type==='dena').reduce((s,r)=>s+r.amount_paisa,0);
 assert.deepEqual(plain(actual),{totalLena:lena,totalDena:dena,netBalance:lena-dena});
}
check(41,'Khata SQL range/type/search rows and totals preserve every hierarchy combination',at('src/services/database/transactionDb.ts','getFilteredKhata'),()=>isolated(async h=>{
 const rows=seedKhataRange(h);
 for(const [viewer,scope] of [['owner',['owner']],['staffA',['staffA']],['subA',['subA']]]) {
  for(const range of [{},{startDate:'2026-09-01',endDate:'2026-09-30'},{startDate:'2026-09-30',endDate:'2026-09-30'},{startDate:'2026-10-01'},{endDate:'2026-08-31'}]) {
   for(const type of ['all','lena','dena']) for(const search of ['', 'NEEDLE','needle note','absent']) {
    const filter={...range,type,search},expected=expectedKhata(rows,scope,filter);
    const result=await khata(h).getFilteredKhata(viewer,filter);
    assert.deepEqual(ids(result.transactions),ids(expected));assertKhataSummary(result.balanceSummary,expected);
   }
  }
 }
}));
check(42,'Khata aggregate includes matches beyond 50 rows; uncapped screen query returns all',at('src/services/database/transactionDb.ts','getFilteredKhata'),()=>isolated(async h=>{
 const rows=seedKhataRange(h),filter={startDate:'2026-09-01',endDate:'2026-09-30',search:'needle',type:'all'};
 const expected=expectedKhata(rows,['staffA'],filter);assert.ok(expected.length>100);
 const first=await khata(h).getFilteredKhata('staffA',filter,50,0);
 const second=await khata(h).getFilteredKhata('staffA',filter,50,50);
 assert.equal(first.transactions.length,50);assert.equal(second.transactions.length,50);
 assert.equal(new Set([...first.transactions,...second.transactions].map(r=>r.id)).size,100);
 assertKhataSummary(first.balanceSummary,expected);assertKhataSummary(second.balanceSummary,expected);
 const all=await khata(h).getFilteredKhata('staffA',filter);assert.deepEqual(ids(all.transactions),ids(expected));
 assert.ok(!read('src/screens/staff/KhataScreen.tsx').includes('transactions.filter('));
}));
check(43,'Khata rejects invalid ranges and treats search punctuation literally',at('src/services/database/transactionDb.ts','getFilteredKhata'),()=>isolated(async h=>{
 seedPeople(h);h.insert('transactions',{id:'literal',userId:'subA',partyName:"100%_O'Brien",amount_paisa:123456,date:'2026-09-10',type:'lena'});
 for(const search of ['%', '_', "O'Brien"]) {
  const result=await khata(h).getFilteredKhata('subA',{search});assert.deepEqual(ids(result.transactions),['literal']);
 }
 const empty=await khata(h).getFilteredKhata('subA',{search:"' OR 1=1 --"});assert.deepEqual(ids(empty.transactions),[]);assertKhataSummary(empty.balanceSummary,[]);
 for(const range of [{startDate:'2026-02-30'},{startDate:'bad'},{startDate:'2026-09-30',endDate:'2026-09-01'}])
  await assert.rejects(()=>khata(h).getFilteredKhata('subA',range),/date/i);
}));
check(44,'Khata range keeps removed users history visible but excludes deleted entries',at('src/services/database/transactionDb.ts','getFilteredKhata'),()=>isolated(async h=>{
 const rows=seedKhataRange(h),filter={startDate:'2026-09-01',endDate:'2026-09-30',type:'lena',search:'needle'};
 h.sqlite.exec("UPDATE users SET is_deleted=1,deleted_at='2026-09-10' WHERE id='subA'");
 // Own-only: the removed sub-staff's rows are NOT in anyone else's book...
 for(const viewer of ['owner','staffA']){const own=await khata(h).getFilteredKhata(viewer,filter);assert.ok(!own.transactions.some(r=>r.userId==='subA'),viewer+' own book');}
 // ...but their parents can still open them read-only through Staff Book (downward only).
 // Two levels: only the owner is above subA. A peer staff member is refused below.
 for(const viewer of ['owner']) {
  const result=await khata(h).getFilteredKhata(viewer,{...filter,createdBy:'subA'}),expected=expectedKhata(rows,['subA'],filter);
  assert.ok(expected.length>0);assert.deepEqual(ids(result.transactions),ids(expected));((r,e)=>assertKhataSummary(r.balanceSummary,e))(result,expected);
  assert.ok(result.transactions.every(r=>r.userId==='subA'),'removed staff history stays visible');
 }
 for(const outsider of ['staffA','staffB','subB','otherOwner'])await assert.rejects(khata(h).getFilteredKhata(outsider,{...filter,createdBy:'subA'}),/own team/);

}));

function seedCashRange(h) {
 seedPeople(h);
 const rows=[];
 for(const who of ['owner','staffA','subA','staffB','subB','otherOwner','otherStaff']) {
  for(let i=0;i<605;i++) {
   const row={id:`range_${who}_${i}`,userId:who,description:i%20?'Needle cash':'Other',
    note:'note-only-token',category:'category-only-token',amount_paisa:10001+i,direction:i%3?'in':'out',
    date:i===0?'2026-08-31':i===604?'2026-10-01':i===1?'2026-09-01':'2026-09-30',isDeleted:i===2?1:0};
   h.insert('cashbook',row);rows.push(row);
  }
 }
 return rows;
}
const expectedCash=(rows,scope,f)=>rows.filter(r=>scope.includes(r.userId)&&!r.isDeleted&&
 (!f.startDate||r.date>=f.startDate)&&(!f.endDate||r.date<=f.endDate)&&
 (!f.direction||f.direction==='all'||r.direction===f.direction)&&
 (!f.search||r.description.toLowerCase().includes(f.search.trim().toLowerCase())));
function assertCashSummary(actual,rows) {
 const lena=rows.filter(r=>r.direction==='in').reduce((s,r)=>s+r.amount_paisa,0);
 const dena=rows.filter(r=>r.direction==='out').reduce((s,r)=>s+r.amount_paisa,0);
 assert.deepEqual(plain(actual),{cashIn:lena,cashOut:dena,cashBalance:lena-dena});
}
check(45,'Cash History SQL range/direction/search: every account gets only its own rows and totals; the drill-down gets exactly the target\'s',at('src/services/database/cashbookDb.ts','getFilteredCashHistory'),()=>isolated(async h=>{
 const rows=seedCashRange(h);
 for(const [viewer,scope,createdBy] of [['owner',['owner']],['staffA',['staffA']],['subA',['subA']],['otherOwner',['otherOwner']],
                                         // Two levels: every drill-down is the owner reaching one of their own staff.
                                         ['owner',['staffA'],'staffA'],['owner',['subB'],'subB'],['owner',['subA'],'subA']]) {
  for(const range of [{},{startDate:'2026-09-01',endDate:'2026-09-30'},{startDate:'2026-09-30',endDate:'2026-09-30'},{startDate:'2026-10-01'},{endDate:'2026-08-31'}]) {
   for(const direction of ['all','in','out']) for(const search of ['', 'NEEDLE','needle note','absent']) {
    const filter={...range,direction,search,...(createdBy?{createdBy}:{})},expected=expectedCash(rows,scope,filter);
    const result=await cash(h).getFilteredCashHistory(viewer,filter);
    assert.deepEqual(ids(result.entries),ids(expected));assertCashSummary(result.cashSummary,expected);
   }
  }
 }
}));
check(46,'Cash History aggregate includes matches beyond 500 rows; uncapped screen query returns all',at('src/services/database/cashbookDb.ts','getFilteredCashHistory'),()=>isolated(async h=>{
 const rows=seedCashRange(h),filter={startDate:'2026-09-01',endDate:'2026-09-30',search:'needle',direction:'all'};
 const expected=expectedCash(rows,['staffA'],filter);assert.ok(expected.length>500);
 const first=await cash(h).getFilteredCashHistory('staffA',filter,500,0);
 const second=await cash(h).getFilteredCashHistory('staffA',filter,500,500);
 assert.equal(first.entries.length,500);assert.equal(second.entries.length,expected.length-500);
 assert.equal(new Set([...first.entries,...second.entries].map(r=>r.id)).size,expected.length);
 assertCashSummary(first.cashSummary,expected);assertCashSummary(second.cashSummary,expected);
 const all=await cash(h).getFilteredCashHistory('staffA',filter);assert.deepEqual(ids(all.entries),ids(expected));
 assert.ok(!/\.filter\(|\.reduce\(/.test(read('src/screens/CashBook/CashHistory.tsx')));
}));
check(47,'Cash History rejects invalid ranges and treats search punctuation literally',at('src/services/database/cashbookDb.ts','getFilteredCashHistory'),()=>isolated(async h=>{
 seedPeople(h);h.insert('cashbook',{id:'literal',userId:'owner',description:"100%_O'Brien",note:'note-only-token',category:'category-only-token',amount_paisa:123456,date:'2026-09-10',direction:'in'});
 for(const search of ['%', '_', "O'Brien"]) {
  const result=await cash(h).getFilteredCashHistory('owner',{search});assert.deepEqual(ids(result.entries),['literal']);
 }
 for(const search of ['note-only-token','category-only-token']) {
  const absent=await cash(h).getFilteredCashHistory('owner',{search});assert.equal(absent.entries.length,0);
 }
 const empty=await cash(h).getFilteredCashHistory('owner',{search:"' OR 1=1 --"});assert.deepEqual(ids(empty.entries),[]);assertCashSummary(empty.cashSummary,[]);
 for(const range of [{startDate:'2026-02-30'},{startDate:'bad'},{startDate:'2026-09-30',endDate:'2026-09-01'}])
  await assert.rejects(()=>cash(h).getFilteredCashHistory('owner',range),/date/i);
}));
check(48,'Cash History: a removed person\'s history stays reachable via the drill-down; deleted entries are excluded whichever flag marked them',at('src/services/database/cashbookDb.ts','getFilteredCashHistory'),()=>isolated(async h=>{
 const rows=seedCashRange(h),filter={startDate:'2026-09-01',endDate:'2026-09-30',direction:'in',search:'needle'};
 h.sqlite.exec("UPDATE users SET is_deleted=1,deleted_at='2026-09-10' WHERE id='subA'");
 // Two levels: only the owner is above subA. A peer staff member is refused below.
 for(const viewer of ['owner']) {
  const result=await cash(h).getFilteredCashHistory(viewer,{...filter,createdBy:'subA'}),expected=expectedCash(rows,['subA'],filter);
  assert.deepEqual(ids(result.entries),ids(expected));assertCashSummary(result.cashSummary,expected);
  assert.ok(result.entries.length>0&&result.entries.every(r=>r.userId==='subA'));
 }
 // The generic soft delete writes is_deleted (not isDeleted). Such a row must vanish from
 // the rows AND every total — it used to stay in the book.
 h.login('owner');
 const e=await cash(h).createCashEntry('owner','Needle gone',777777,'in','2026-09-15');
 const before=await cash(h).getFilteredCashHistory('owner',filter);
 await cash(h).deleteCashEntry(e.id,'owner');
 const row=h.one('SELECT isDeleted, is_deleted FROM cashbook WHERE id=?',e.id);
 assert.ok(row,'soft delete keeps the row');assert.equal(row.is_deleted,1);
 const gone=await cash(h).getFilteredCashHistory('owner',filter);
 assert.ok(!gone.entries.some(r=>r.id===e.id),'deleted entry must not be listed');
 assert.equal(gone.cashSummary.cashIn,before.cashSummary.cashIn-777777,'deleted entry must leave the totals');
 assert.equal(await cash(h).getCashEntryById(e.id),null);
 assert.ok(!(await cash(h).getDayBook('owner','2026-09-15')).entries.some(r=>r.id===e.id));
}));

// ── Expense range filtering ───────────────────────────────────────────────────
const expenseDb=h=>h.load('src/services/database/expenseDb.ts');
function seedExpenseRange(h) {
 seedPeople(h);
 const rows=[];
 for(const who of ['owner','staffA','subA','staffB','subB','otherOwner','otherStaff']) {
  for(let i=0;i<120;i++) {
   const row={id:`exp_${who}_${i}`,user_id:who,description:i%20?'Needle expense':'Other',
    note:'note-only-token',category:i%4?'Rent':'Fuel',amount:10001+i,
    expense_date:i===0?'2026-08-31':i===119?'2026-10-01':i===1?'2026-09-01':'2026-09-30',is_deleted:i===2?1:0};
   h.insert('expenses',row);rows.push(row);
  }
 }
 return rows;
}
const expectedExpense=(rows,scope,f)=>rows.filter(r=>scope.includes(r.user_id)&&!r.is_deleted&&
 (!f.startDate||r.expense_date>=f.startDate)&&(!f.endDate||r.expense_date<=f.endDate)&&
 (!f.category||!f.category.trim()||r.category===f.category.trim())&&
 (!f.search||!f.search.trim()||[r.description,r.note,r.category].some(v=>(v||'').toLowerCase().includes(f.search.trim().toLowerCase()))));
// The fixtures are all PKR, so the grouped total is one line. Comparing the WHOLE
// shape (not just the amount) is deliberate: it fails if anyone flattens it back to a
// scalar, and it fails if a second currency appears where the test expects one.
const assertExpenseSummary=(actual,rows)=>assert.deepEqual(plain(actual),
 {totalExpense:[{currency:'PKR',amount:rows.reduce((s,r)=>s+r.amount,0)}]});

check(49,'Expense SQL range/category/search rows and totals preserve every hierarchy combination',at('src/services/database/expenseDb.ts','getFilteredExpenses'),()=>isolated(async h=>{
 const rows=seedExpenseRange(h);
 for(const [viewer,scope] of [['owner',['owner']],['staffA',['staffA']],['subA',['subA']]]) {
  for(const range of [{},{startDate:'2026-09-01',endDate:'2026-09-30'},{startDate:'2026-09-30',endDate:'2026-09-30'},{startDate:'2026-10-01'},{endDate:'2026-08-31'}]) {
   for(const category of ['','Rent','Fuel']) for(const search of ['','Needle','note-only-token','absent']) {
    const filter={...range,category,search},expected=expectedExpense(rows,scope,filter);
    const result=await expenseDb(h).getFilteredExpenses(viewer,filter);
    assert.deepEqual(ids(result.expenses),ids(expected));assertExpenseSummary(result.expenseSummary,expected);
   }
  }
 }
}));

check(50,'Expense total sums the whole filtered set, not the loaded page',at('src/services/database/expenseDb.ts','getFilteredExpenses'),()=>isolated(async h=>{
 const rows=seedExpenseRange(h),filter={startDate:'2026-09-01',endDate:'2026-09-30',search:'Needle'};
 const expected=expectedExpense(rows,['staffA'],filter);assert.ok(expected.length>100,'fixture must exceed any page size');
 const first=await expenseDb(h).getFilteredExpenses('staffA',filter,50,0);
 const second=await expenseDb(h).getFilteredExpenses('staffA',filter,50,50);
 assert.equal(first.expenses.length,50);assert.equal(second.expenses.length,50);
 assert.equal(new Set([...first.expenses,...second.expenses].map(r=>r.id)).size,100);
 // Both pages report the SAME whole-set total — the paginated-array bug, asserted directly.
 assertExpenseSummary(first.expenseSummary,expected);assertExpenseSummary(second.expenseSummary,expected);
 const all=await expenseDb(h).getFilteredExpenses('staffA',filter);assert.deepEqual(ids(all.expenses),ids(expected));
 // Paisa: the total must be the integer sum, and render without double conversion.
 const paisa=expected.reduce((s,r)=>s+r.amount,0);
 assert.ok(Number.isSafeInteger(paisa));
 assert.equal(calc(h).formatCurrency(paisa),calc(h).formatCurrency(only(all.expenseSummary.totalExpense)));
 // No in-memory narrowing left on the screen or in the store.
 assert.ok(!read('src/screens/ExpenseBook/ExpenseBookScreen.tsx').includes('expenses.filter('));
 assert.ok(!/expenses\.reduce\(/.test(read('src/store/useExpenseStore.ts')),'store must not sum a page in memory');
}));

check(51,'Expense rejects invalid ranges, both boundaries inclusive, search literal',at('src/services/database/expenseDb.ts','getFilteredExpenses'),()=>isolated(async h=>{
 seedPeople(h);
 h.insert('expenses',{id:'lo',user_id:'subA',description:'edge low',amount:100,expense_date:'2026-09-01'});
 h.insert('expenses',{id:'hi',user_id:'subA',description:'edge high',amount:200,expense_date:'2026-09-30'});
 h.insert('expenses',{id:'literal',user_id:'subA',description:"100%_O'Brien",amount:300,expense_date:'2026-09-15'});
 // Both boundary days are INSIDE the range.
 const inRange=await expenseDb(h).getFilteredExpenses('subA',{startDate:'2026-09-01',endDate:'2026-09-30'});
 assert.deepEqual(ids(inRange.expenses),ids([{id:'lo'},{id:'hi'},{id:'literal'}]));
 assert.equal(only(inRange.expenseSummary.totalExpense),600);
 for(const search of ['%','_',"O'Brien"]) {
  const r=await expenseDb(h).getFilteredExpenses('subA',{search});assert.deepEqual(ids(r.expenses),['literal']);
 }
 const none=await expenseDb(h).getFilteredExpenses('subA',{search:"' OR 1=1 --"});
 assert.deepEqual(ids(none.expenses),[]);assertExpenseSummary(none.expenseSummary,[]);
 for(const range of [{startDate:'2026-02-30'},{startDate:'bad'},{startDate:'2026-09-30',endDate:'2026-09-01'}])
  await assert.rejects(expenseDb(h).getFilteredExpenses('subA',range));
}));

check(52,'previous months are reachable and the month cursor is gone',at('src/store/useExpenseStore.ts','filter'),()=>isolated(async h=>{
 seedPeople(h);
 h.insert('expenses',{id:'july',user_id:'subA',description:'July rent',amount:5000,expense_date:'2026-07-15'});
 h.insert('expenses',{id:'sept',user_id:'subA',description:'Sept rent',amount:7000,expense_date:'2026-09-15'});
 // The month-lock regression: an older month must be selectable and total correctly.
 const july=await expenseDb(h).getFilteredExpenses('subA',{startDate:'2026-07-01',endDate:'2026-07-31'});
 assert.deepEqual(ids(july.expenses),['july']);assert.equal(only(july.expenseSummary.totalExpense),5000);
 const sept=await expenseDb(h).getFilteredExpenses('subA',{startDate:'2026-09-01',endDate:'2026-09-30'});
 assert.deepEqual(ids(sept.expenses),['sept']);assert.equal(only(sept.expenseSummary.totalExpense),7000);
 const both=await expenseDb(h).getFilteredExpenses('subA',{});
 assert.deepEqual(ids(both.expenses),['july','sept']);assert.equal(only(both.expenseSummary.totalExpense),12000);
 // The never-called month cursor is removed, and the screen mounts the shared control.
 const store=read('src/store/useExpenseStore.ts');
 assert.ok(!/setMonth/.test(store.replace(/^\s*\/\/.*$/gm,'')),'setMonth must be gone');
 assert.ok(!/currentDate/.test(store.replace(/^\s*\/\/.*$/gm,'')),'currentDate cursor must be gone');
 assert.ok(read('src/screens/ExpenseBook/ExpenseBookScreen.tsx').includes('<DateRangeFilter'));
 // Month helpers that the dashboard still uses must derive the LOCAL month.
 assert.ok(!/toISOString\(\)\.substring\(0, 7\)/.test(read('src/services/database/expenseDb.ts')));
}));

check(53,'Expense range keeps removed users history visible but excludes deleted rows',at('src/services/database/expenseDb.ts','getFilteredExpenses'),()=>isolated(async h=>{
 const rows=seedExpenseRange(h),filter={startDate:'2026-09-01',endDate:'2026-09-30',search:'Needle'};
 h.sqlite.exec("UPDATE users SET is_deleted=1,deleted_at='2026-09-10' WHERE id='subA'");
 // Own-only: the removed sub-staff's rows are NOT in anyone else's book...
 for(const viewer of ['owner','staffA']){const own=await expenseDb(h).getFilteredExpenses(viewer,filter);assert.ok(!own.expenses.some(r=>r.user_id==='subA'),viewer+' own book');}
 // ...but their parents can still open them read-only through Staff Book (downward only).
 // Two levels: only the owner is above subA. A peer staff member is refused below.
 for(const viewer of ['owner']) {
  const result=await expenseDb(h).getFilteredExpenses(viewer,{...filter,createdBy:'subA'}),expected=expectedExpense(rows,['subA'],filter);
  assert.ok(expected.length>0);assert.deepEqual(ids(result.expenses),ids(expected));((r,e)=>assertExpenseSummary(r.expenseSummary,e))(result,expected);
  assert.ok(result.expenses.every(r=>r.user_id==='subA'),'removed staff history stays visible');
 }
 for(const outsider of ['staffA','staffB','subB','otherOwner'])await assert.rejects(expenseDb(h).getFilteredExpenses(outsider,{...filter,createdBy:'subA'}),/own team/);

}));

// ── Bill Book range filtering ─────────────────────────────────────────────────
const billDb=h=>h.load('src/services/database/billDb.ts');
function seedBillRange(h) {
 seedPeople(h);
 const rows=[];
 for(const who of ['owner','staffA','subA','staffB','subB','otherOwner','otherStaff']) {
  for(let i=0;i<120;i++) {
   const row={id:`bill_${who}_${i}`,user_id:who,party_name:i%20?'Needle Traders':'Other Co',
    party_phone:'03001234567',bill_no:1000+i,customer_id:'walk_in',status:'unpaid',
    total:10001+i,paid:1,due:10000+i,
    bill_date:i===0?'2026-08-31':i===119?'2026-10-01':i===1?'2026-09-01':'2026-09-30',
    is_draft:i===3?1:0,is_hold:i===4?1:0,is_deleted:i===2?1:0};
   h.insert('bills',row);rows.push(row);
  }
 }
 return rows;
}
const expectedBills=(rows,scope,f)=>rows.filter(r=>scope.includes(r.user_id)&&!r.is_deleted&&
 (!f.startDate||r.bill_date>=f.startDate)&&(!f.endDate||r.bill_date<=f.endDate)&&
 (!f.status||f.status==='all'
   ||(f.status==='drafts'&&r.is_draft===1)
   ||(f.status==='holds'&&r.is_hold===1)
   ||(f.status==='posted'&&r.is_draft!==1&&r.is_hold!==1))&&
 (!f.search||!f.search.trim()||[r.party_name,r.party_phone,String(r.bill_no)]
   .some(v=>(v||'').toLowerCase().includes(f.search.trim().toLowerCase()))));
function assertBillSummary(actual,rows) {
 // The fixtures are all PKR, so each grouped total is one line. Comparing the WHOLE
 // shape is deliberate: it fails if anyone flattens these back to a scalar SUM, and it
 // fails if a second currency turns up where the test expects one.
 const one=(pick)=>[{currency:'PKR',amount:rows.reduce((s,r)=>s+pick(r),0)}];
 assert.deepEqual(plain(actual),{
  billCount:rows.length,
  totalBilled:one(r=>r.total),
  totalPaid:one(r=>r.paid),
  totalDue:one(r=>r.due),
 });
}

check(54,'Bill SQL range/status/search rows and totals preserve every hierarchy combination',at('src/services/database/billDb.ts','getFilteredBills'),()=>isolated(async h=>{
 const rows=seedBillRange(h);
 for(const [viewer,scope] of [['owner',['owner']],['staffA',['staffA']],['subA',['subA']]]) {
  for(const range of [{},{startDate:'2026-09-01',endDate:'2026-09-30'},{startDate:'2026-09-30',endDate:'2026-09-30'},{startDate:'2026-10-01'},{endDate:'2026-08-31'}]) {
   for(const status of ['all','posted','drafts','holds']) for(const search of ['','Needle','03001234567','absent']) {
    const filter={...range,status,search},expected=expectedBills(rows,scope,filter);
    const result=await billDb(h).getFilteredBills(viewer,filter);
    assert.deepEqual(ids(result.bills),ids(expected));assertBillSummary(result.billSummary,expected);
   }
  }
 }
}));

check(55,'LAST MONTH bills are reachable and both boundaries are inclusive',at('src/services/database/billDb.ts','getFilteredBills'),()=>isolated(async h=>{
 seedPeople(h);
 const mk=(id,date,total)=>h.insert('bills',{id,user_id:'subA',party_name:'P',bill_no:1,customer_id:'c',
  status:'unpaid',total,paid:0,due:total,bill_date:date,is_draft:0,is_hold:0});
 mk('aug01','2026-08-01',10000);mk('aug31','2026-08-31',20000);mk('sep15','2026-09-15',30000);
 // The core regression: a PREVIOUS month must be selectable, with its own total.
 const august=await billDb(h).getFilteredBills('subA',{startDate:'2026-08-01',endDate:'2026-08-31',status:'posted'});
 assert.deepEqual(ids(august.bills),['aug01','aug31'],'last month must be reachable');
 assert.equal(only(august.billSummary.totalBilled),30000);assert.equal(august.billSummary.billCount,2);
 // Both boundary days are INSIDE the range (aug01 and aug31 above prove it).
 const sept=await billDb(h).getFilteredBills('subA',{startDate:'2026-09-01',endDate:'2026-09-30',status:'posted'});
 assert.deepEqual(ids(sept.bills),['sep15']);assert.equal(only(sept.billSummary.totalBilled),30000);
 const all=await billDb(h).getFilteredBills('subA',{status:'posted'});
 assert.deepEqual(ids(all.bills),['aug01','aug31','sep15']);assert.equal(only(all.billSummary.totalBilled),60000);
 // The fake hardcoded date boxes are gone and the real control is mounted.
 const screen=read('src/screens/BillBook/BillBookScreen.tsx');
 assert.ok(!/1 Jun, 2026|30 Jun, 2026/.test(screen),'hardcoded fake dates must be gone');
 assert.ok(screen.includes('<DateRangeFilter'));
 assert.ok(!/bills\.filter\(/.test(screen),'status must be filtered in SQL, not in memory');
 const store=read('src/store/useBillStore.ts');
 assert.ok(!/setDateRange|selectedDateRange/.test(store),'the never-called range setter must be gone');
}));

check(56,'Bill headline sums the whole filtered set, not the loaded page',at('src/services/database/billDb.ts','getFilteredBills'),()=>isolated(async h=>{
 const rows=seedBillRange(h),filter={startDate:'2026-09-01',endDate:'2026-09-30',status:'posted',search:'Needle'};
 const expected=expectedBills(rows,['staffA'],filter);assert.ok(expected.length>100,'fixture must exceed any page size');
 const first=await billDb(h).getFilteredBills('staffA',filter,50,0);
 const second=await billDb(h).getFilteredBills('staffA',filter,50,50);
 assert.equal(first.bills.length,50);assert.equal(second.bills.length,50);
 assert.equal(new Set([...first.bills,...second.bills].map(r=>r.id)).size,100);
 // Both pages report the SAME whole-set totals.
 assertBillSummary(first.billSummary,expected);assertBillSummary(second.billSummary,expected);
 const all=await billDb(h).getFilteredBills('staffA',filter);assert.deepEqual(ids(all.bills),ids(expected));
 // Paisa: integer totals that render identically to an independent sum.
 const paisa=expected.reduce((s,r)=>s+r.total,0);
 assert.ok(Number.isSafeInteger(paisa));
 assert.equal(calc(h).formatCurrency(paisa),calc(h).formatCurrency(only(all.billSummary.totalBilled)));
}));

check(57,'a backdated bill is reported, never optimistically shown in a range it is not in',at('src/store/useBillStore.ts','addBill'),()=>isolated(async h=>{
 seedPeople(h);
 const { billMatchesFilter }=billDb(h);
 const sept={bill_date:'2026-09-15',is_draft:0,is_hold:0},aug={bill_date:'2026-08-15',is_draft:0,is_hold:0};
 const septFilter={startDate:'2026-09-01',endDate:'2026-09-30',status:'posted'};
 assert.equal(billMatchesFilter(sept,septFilter),true);
 assert.equal(billMatchesFilter(aug,septFilter),false,'a backdated bill must be reported as out of range');
 assert.equal(billMatchesFilter({bill_date:'2026-09-15',is_draft:1,is_hold:0},septFilter),false);
 assert.equal(billMatchesFilter(aug,{}),true,'with no range everything is in view');
 assert.equal(billMatchesFilter({bill_date:'not-a-date',is_draft:0,is_hold:0},{}),false);
 // The store re-reads instead of prepending, so list and totals always agree.
 const store=read('src/store/useBillStore.ts');
 assert.ok(!/bills:\s*\[newBill/.test(store),'optimistic prepend must be gone');
 assert.ok(/inActiveFilter/.test(store)&&/await get\(\)\.fetchBills/.test(store));
 assert.ok(read('src/screens/BillBook/CreateNewBillModal.tsx').includes('inActiveFilter'),'the save screen must tell the user');
}));

check(58,'Bill range keeps removed users history visible but excludes deleted bills',at('src/services/database/billDb.ts','getFilteredBills'),()=>isolated(async h=>{
 const rows=seedBillRange(h),filter={startDate:'2026-09-01',endDate:'2026-09-30',status:'posted',search:'Needle'};
 h.sqlite.exec("UPDATE users SET is_deleted=1,deleted_at='2026-09-10' WHERE id='subA'");
 // Own-only: the removed sub-staff's rows are NOT in anyone else's book...
 for(const viewer of ['owner','staffA']){const own=await billDb(h).getFilteredBills(viewer,filter);assert.ok(!own.bills.some(r=>r.user_id==='subA'),viewer+' own book');}
 // ...but their parents can still open them read-only through Staff Book (downward only).
 // Two levels: only the owner is above subA. A peer staff member is refused below.
 for(const viewer of ['owner']) {
  const result=await billDb(h).getFilteredBills(viewer,{...filter,createdBy:'subA'}),expected=expectedBills(rows,['subA'],filter);
  assert.ok(expected.length>0);assert.deepEqual(ids(result.bills),ids(expected));((r,e)=>assertBillSummary(r.billSummary,e))(result,expected);
  assert.ok(result.bills.every(r=>r.user_id==='subA'),'removed staff history stays visible');
 }
 for(const outsider of ['staffA','staffB','subB','otherOwner'])await assert.rejects(billDb(h).getFilteredBills(outsider,{...filter,createdBy:'subA'}),/own team/);

 // A soft-deleted bill is excluded from both rows and totals.
 assert.ok(rows.some(r=>r.is_deleted));
 const all=await billDb(h).getFilteredBills('owner',{});
 assert.ok(!all.bills.some(r=>r.id.endsWith('_2')),'deleted bills excluded');
}));

// ── Day Book (Part A: the day view) ───────────────────────────────────────────
function seedDays(h) {
 seedPeople(h);
 const rows=[];
 // Three days across the whole tree, so per-day totals and scoping are both testable.
 for(const who of ['owner','staffA','subA','staffB','subB','otherOwner','otherStaff']) {
  for(const [i,day] of ['2026-09-10','2026-09-11','2026-09-12'].entries()) {
   const inRow={id:`d_${who}_${day}_in`,userId:who,description:'In '+day,amount_paisa:10000+i,direction:'in',date:day,isDeleted:0};
   const outRow={id:`d_${who}_${day}_out`,userId:who,description:'Out '+day,amount_paisa:2000+i,direction:'out',date:day,isDeleted:0};
   h.insert('cashbook',inRow);h.insert('cashbook',outRow);rows.push(inRow,outRow);
  }
  // A deleted row must never appear in a day or its totals.
  const gone={id:`d_${who}_deleted`,userId:who,description:'Deleted',amount_paisa:999999,direction:'in',date:'2026-09-11',isDeleted:1};
  h.insert('cashbook',gone);rows.push(gone);
 }
 return rows;
}
const expectedDay=(rows,scope,day)=>rows.filter(r=>scope.includes(r.userId)&&!r.isDeleted&&r.date===day);
function assertDayTotals(actual,rows) {
 const cashIn=rows.filter(r=>r.direction==='in').reduce((s,r)=>s+r.amount_paisa,0);
 const cashOut=rows.filter(r=>r.direction==='out').reduce((s,r)=>s+r.amount_paisa,0);
 assert.deepEqual(plain(actual),{cashIn,cashOut,net:cashIn-cashOut,entryCount:rows.length});
}

check(59,'any past day returns exactly that account\'s own entries for that day, with SQL totals',at('src/services/database/cashbookDb.ts','getDayBook'),()=>isolated(async h=>{
 const rows=seedDays(h);
 for(const [viewer,scope] of [['owner',['owner']],['staffA',['staffA']],['subA',['subA']],['otherOwner',['otherOwner']],['otherStaff',['otherStaff']]]) {
  for(const day of ['2026-09-10','2026-09-11','2026-09-12','2026-09-13']) {
   const expected=expectedDay(rows,scope,day);
   const result=await cash(h).getDayBook(viewer,day);
   assert.deepEqual(ids(result.entries),ids(expected),viewer+' on '+day);
   assertDayTotals(result.dayTotals,expected);
   // Past days must never be empty just because they are past.
   if(day!=='2026-09-13')assert.ok(expected.length>0&&result.entries.length>0);
  }
 }
 // OWN-ONLY: the owner's day never contains a staff row, and every row belongs to the viewer.
 const ownerDay=await cash(h).getDayBook('owner','2026-09-11');
 assert.ok(ownerDay.entries.length>0&&ownerDay.entries.every(e=>e.userId==='owner'),'owner day holds only the owner\'s rows');
}));

check(60,'Cash in Hand stays all-time while day totals are per-day; rollover hides nothing',at('src/services/database/cashbookDb.ts','getDayBook'),()=>isolated(async h=>{
 const rows=seedDays(h);
 const allTime=await cash(h).getCashBalanceSummary('owner');
 const scope=['owner'];
 const everyDay=rows.filter(r=>scope.includes(r.userId)&&!r.isDeleted);
 const expectIn=everyDay.filter(r=>r.direction==='in').reduce((s,r)=>s+r.amount_paisa,0);
 assert.equal(allTime.cashIn,expectIn,'Cash in Hand must remain the all-time running figure');
 // Each day is a strict subset, and the days sum back to the all-time figure.
 let summed=0;
 for(const day of ['2026-09-10','2026-09-11','2026-09-12']) {
  const d=await cash(h).getDayBook('owner',day);
  assert.ok(d.dayTotals.cashIn<allTime.cashIn,'a single day must be less than all time');
  summed+=d.dayTotals.cashIn;
 }
 assert.equal(summed,allTime.cashIn,'days must account for the whole all-time total — nothing lost to rollover');
 // Every seeded row is still physically present: a day view filters, it never removes.
 assert.equal(h.one('SELECT COUNT(*) AS n FROM cashbook').n,rows.length);
}));

check(61,'day predicate matches legacy timestamp rows and rejects invalid dates',at('src/services/database/cashbookDb.ts','getDayBook'),()=>isolated(async h=>{
 seedPeople(h);
 // Pre-unification rows could hold a full timestamp; exact string equality missed them.
 h.insert('cashbook',{id:'legacy_ts',userId:'owner',description:'Legacy',amount_paisa:7000,direction:'in',date:'2026-09-11T18:30:00.000Z',isDeleted:0});
 h.insert('cashbook',{id:'plain',userId:'owner',description:'Plain',amount_paisa:3000,direction:'in',date:'2026-09-11',isDeleted:0});
 const day=await cash(h).getDayBook('owner','2026-09-11');
 assert.deepEqual(ids(day.entries),['legacy_ts','plain'],'a legacy timestamp row must still match its calendar day');
 assert.equal(day.dayTotals.cashIn,10000);
 for(const bad of ['2026-99-99','2026-02-30','not-a-date','2026-9-1',''])
  await assert.rejects(cash(h).getDayBook('owner',bad),/Invalid date/);
 // The removed helper is gone and the screen no longer sums in JS.
 assert.ok(!/getTodayBalance|getTodayCashEntries/.test(read('src/services/database/cashbookDb.ts')));
 const screen=read('src/screens/CashBook/CashBookScreen.tsx');
 assert.ok(!/todayEntries\.filter\([^)]*\)\.reduce/.test(screen),'day totals must come from SQL, not a JS reduce');
 assert.ok(screen.includes('getDayBook')&&screen.includes('<DateField'),'screen must use the day navigator');
}));

check(62,'the day view defaults to today, cannot browse the future, and keeps CashHistory',at('src/screens/CashBook/CashBookScreen.tsx','stepDay'),()=>{
 const screen=read('src/screens/CashBook/CashBookScreen.tsx');
 assert.ok(/useState\(todayDate\(\)\)/.test(screen),'must default to today');
 assert.ok(/if\s*\(next > today\)\s*return;/.test(screen),'must refuse future days');
 assert.ok(/maximumDate=\{new Date\(\)\}/.test(screen),'the jump picker must cap at today');
 assert.ok(/disabled=\{isToday\}/.test(screen),'next must be disabled on today');
 assert.ok(/setViewDate\(today\)/.test(screen),'a Today chip must return to today');
 // CashHistory remains the range view and is still reachable from here.
 assert.ok(screen.includes("navigation.navigate('CashHistory')"));
 const history=read('src/screens/CashBook/CashHistory.tsx');
 assert.ok(history.includes('getFilteredCashHistory')&&history.includes('DateRangeFilter'),'CashHistory stays the range view');
});

// ── Day Book (Part B: Close Day snapshots) ────────────────────────────────────
const closingDb=h=>h.load('src/services/database/dayClosingDb.ts');
const DAY='2026-09-11';
function seedClosableDay(h) {
 seedPeople(h);
 h.insert('cashbook',{id:'c1',userId:'staffA',description:'Sale',amount_paisa:50000,direction:'in',date:DAY,isDeleted:0});
 h.insert('cashbook',{id:'c2',userId:'staffA',description:'Rent',amount_paisa:20000,direction:'out',date:DAY,isDeleted:0});
 // A sub-staff's entry on the same day: own-only, so it is NOT in staffA's day or closing.
 h.insert('cashbook',{id:'c4',userId:'subA',description:'Sub sale',amount_paisa:4000,direction:'in',date:DAY,isDeleted:0});
 h.insert('cashbook',{id:'c3',userId:'staffB',description:'Other branch',amount_paisa:99999,direction:'in',date:DAY,isDeleted:0});
}

check(63,'closing records exactly the day totals at that moment, scoped to the closer',at('src/services/database/dayClosingDb.ts','closeDay'),()=>isolated(async h=>{
 seedClosableDay(h);h.login('staffA');
 const before=await cash(h).getDayBook('staffA',DAY);
 assert.deepEqual(plain(before.dayTotals),{cashIn:50000,cashOut:20000,net:30000,entryCount:2});
 const closed=await closingDb(h).closeDay(DAY);
 assert.equal(closed.cash_in_paisa,50000);assert.equal(closed.cash_out_paisa,20000);
 assert.equal(closed.closing_balance_paisa,30000);assert.equal(closed.entry_count,2);
 assert.equal(closed.business_date,DAY);
 assert.equal(closed.closed_by,'staffA');assert.equal(closed.closed_by_name,'staffA');
 // The snapshot never includes another branch.
 assert.notEqual(closed.cash_in_paisa,149999);
 // Closing touched no entry.
 assert.equal(h.one('SELECT COUNT(*) AS n FROM cashbook').n,4);
 assert.deepEqual(ids((await cash(h).getDayBook('staffA',DAY)).entries),['c1','c2']);
}));

check(64,'a later entry leaves the snapshot untouched and surfaces the drift',at('src/services/database/dayClosingDb.ts','getDayStatus'),()=>isolated(async h=>{
 seedClosableDay(h);h.login('staffA');
 const closed=await closingDb(h).closeDay(DAY);
 let status=await closingDb(h).getDayStatus('staffA',DAY);
 assert.equal(status.drifted,false,'a freshly closed day has not drifted');
 assert.equal(status.latest.closing_balance_paisa,30000);
 // The forgotten entry a staff member records afterwards — allowed, never blocked.
 await cash(h).createCashEntry('staffA','Forgotten sale',5000,'in',DAY);
 status=await closingDb(h).getDayStatus('staffA',DAY);
 assert.equal(status.drifted,true,'adding after close must surface as drift');
 // Snapshot frozen…
 assert.equal(status.latest.closing_balance_paisa,30000);
 assert.equal(status.latest.cash_in_paisa,50000);
 assert.equal(status.latest.entry_count,2);
 // …while the live figure moved. BOTH are available; neither is silently corrected.
 assert.equal(status.current.net,35000);
 assert.equal(status.current.cashIn,55000);
 assert.equal(status.current.entryCount,3);
 // The stored row itself is byte-identical to what was written.
 const stored=h.one('SELECT * FROM day_closings WHERE id=?',closed.id);
 assert.equal(stored.closing_balance_paisa,30000);assert.equal(stored.entry_count,2);
}));

check(65,'re-closing appends a second record and closings can never be altered',at('src/services/database/dayClosingMigration.ts','day_closings_no_update'),()=>isolated(async h=>{
 seedClosableDay(h);h.login('staffA');
 const first=await closingDb(h).closeDay(DAY);
 await cash(h).createCashEntry('staffA','Late entry',5000,'in',DAY);
 const second=await closingDb(h).closeDay(DAY);
 assert.notEqual(first.id,second.id);
 const status=await closingDb(h).getDayStatus('staffA',DAY);
 assert.equal(status.closings.length,2,'re-closing must append, never overwrite');
 assert.equal(status.latest.id,second.id,'newest closing leads');
 assert.equal(status.latest.closing_balance_paisa,35000);
 assert.equal(status.closings[1].closing_balance_paisa,30000,'the earlier closing is kept');
 assert.equal(status.drifted,false,'re-closing reconciles the drift by recording it');
 // Append-only in the database itself, like entry_audit.
 assert.throws(()=>h.sqlite.exec("UPDATE day_closings SET closing_balance_paisa = 1"),/cannot be changed/);
 assert.throws(()=>h.sqlite.exec("DELETE FROM day_closings"),/cannot be deleted/);
 assert.equal(h.one('SELECT COUNT(*) AS n FROM day_closings').n,2);
}));

check(66,'an unclosed day behaves exactly as before the feature existed',at('src/services/database/dayClosingDb.ts','getDayStatus'),()=>isolated(async h=>{
 seedClosableDay(h);h.login('staffA');
 const status=await closingDb(h).getDayStatus('staffA',DAY);
 assert.equal(status.latest,null,'never closed means no snapshot');
 assert.deepEqual(status.closings,[]);
 assert.equal(status.drifted,false,'an unclosed day can never be drifted');
 assert.deepEqual(plain(status.current),{cashIn:50000,cashOut:20000,net:30000,entryCount:2});
 // Entries still add, read and total identically with nothing ever closed.
 await cash(h).createCashEntry('staffA','Normal entry',1000,'in',DAY);
 const after=await cash(h).getDayBook('staffA',DAY);
 assert.equal(after.dayTotals.cashIn,51000);assert.equal(after.entries.length,3);
 assert.equal(h.one('SELECT COUNT(*) AS n FROM day_closings').n,0,'nothing is written unless someone closes');
 // A future day cannot be closed.
 await assert.rejects(closingDb(h).closeDay('2099-01-01'),/future day/);
 for(const bad of ['2026-99-99','nope',''])await assert.rejects(closingDb(h).closeDay(bad),/Invalid date/);
}));

check(67,'owner and staff may close; sub-staff may not; each account sees only its own closings',at('src/services/database/dayClosingDb.ts','mayCloseDay'),()=>isolated(async h=>{
 seedClosableDay(h);
 const { mayCloseDay }=closingDb(h);
 assert.equal(mayCloseDay({role:'admin',account_level:'admin'}),true);
 assert.equal(mayCloseDay({role:'staff',account_level:'staff'}),true);
 // The gate is KEPT although the two-level tree makes it constant-true for live accounts:
 // it is the named boundary for who signs a day off. It must still refuse a level below
 // staff, so that a third level returning does not silently gain the right.
 assert.equal(mayCloseDay({role:'staff',account_level:'substaff'}),false,'a level below staff does not sign the day off');
 assert.ok(/CONSTANT-TRUE UNDER THE TWO-LEVEL TREE/.test(read('src/services/database/dayClosingDb.ts')),'and it says so');

 h.login('staffA');await closingDb(h).closeDay(DAY);
 h.login('staffB');await closingDb(h).closeDay(DAY);

 // Each closing belongs to the account that made it and is seen only by that account —
 // an owner's day status is never compared against a staff member's closing.
 assert.deepEqual(sorted((await closingDb(h).getDayClosings('staffA',DAY)).map(c=>c.user_id)),['staffA']);
 assert.deepEqual(sorted((await closingDb(h).getDayClosings('staffB',DAY)).map(c=>c.user_id)),['staffB']);
 assert.deepEqual(plain(await closingDb(h).getDayClosings('owner',DAY)),[],'own-only: the owner has not closed');
 assert.equal((await closingDb(h).getDayStatus('owner',DAY)).latest,null);
 assert.deepEqual(plain(await closingDb(h).getDayClosings('otherOwner',DAY)),[],'another business sees nothing');
 assert.deepEqual(plain(await closingDb(h).getDayClosings('subA',DAY)),[]);
}));

// ── Export period selector (Prompt 14) ───────────────────────────────────────
const periodApi=h=>h.load('src/components/Download/reportPeriod.ts');
const shown=(h,d)=>h.load('src/utils/dates.ts').formatDisplayDate(d);
// "now" is fixed so the presets are deterministic regardless of the clock or TZ.
const NOW=new Date(2026,8,11,12);
// tag → calendar day. d0 today; d1 inside 7 days; d2 just outside 7 days; d3/d4 the
// month's first and last day; d5/d6 just outside the month on either side.
const DAYS={d0:'2026-09-11',d1:'2026-09-05',d2:'2026-09-04',d3:'2026-09-01',d4:'2026-09-30',d5:'2026-08-31',d6:'2026-10-01'};
const IN_PRESET={today:['d0'],week:['d0','d1'],month:['d0','d1','d2','d3','d4']};
function seedPeriods(h){
 seedPeople(h);let n=0;
 for(const who of ['owner','staffA','subA','staffB','subB','otherStaff'])for(const [tag,day] of Object.entries(DAYS)){
  const label='ROW_'+who+'_'+tag;n++;
  h.insert('cashbook',{id:'cash_'+label,userId:who,description:label,amount_paisa:100000+n,direction:n%2?'in':'out',date:day,isDeleted:0});
  h.insert('expenses',{id:'exp_'+label,user_id:who,description:label,amount:200000+n,expense_date:day});
  h.insert('bills',{id:'bill_'+label,user_id:who,party_name:label,bill_no:n,total:300000+n,paid:1000,due:299000+n,bill_date:day});
  // A draft and a hold on every day: not sales, so they must never reach a bill export.
  h.insert('bills',{id:'draft_'+label,user_id:who,party_name:'DRAFT_'+who+'_'+tag,bill_no:1000+n,total:7000000,paid:0,due:7000000,bill_date:day,is_draft:1,is_hold:0});
  h.insert('bills',{id:'hold_'+label,user_id:who,party_name:'HOLD_'+who+'_'+tag,bill_no:2000+n,total:9000000,paid:0,due:9000000,bill_date:day,is_draft:0,is_hold:1});
  h.insert('stock_items',{id:'item_'+label,user_id:who,name_en:label,purchase_price:1,sale_price:1,quantity:5});
  h.insert('stock_movements',{id:'mv_'+label,user_id:who,item_id:'item_'+label,change:n%2?2:-1,cost_per_unit:40000+n,sale_price_unit:50000+n,date:day});
 }
}
const tagsIn=text=>sorted(new Set(text.match(/ROW_[A-Za-z]+_d\d/g)||[]));
const expectTags=(whos,tags)=>sorted(whos.flatMap(w=>tags.map(t=>'ROW_'+w+'_'+t)));
const OWNER_TREE=['owner','staffA','subA','staffB','subB'];
async function exportFile(h,type,userId,period,format='pdf'){
 const before=format==='pdf'?h.html.length:h.csv.length;
 await h.load(pdf).generateReportFile({reportType:type,userId,format,...period});
 const out=format==='pdf'?h.html:h.csv;assert.equal(out.length,before+1,'no '+format+' produced');return out.at(-1);
}
async function bookFigures(h,type,who,period){
 if(type==='cash'){const r=await cash(h).getFilteredCashHistory(who,period);return {tags:tagsIn(r.entries.map(e=>e.description).join(' ')),money:[r.cashSummary.cashIn,r.cashSummary.cashOut,r.cashSummary.cashBalance]};}
 if(type==='expense'){const r=await h.load('src/services/database/expenseDb.ts').getFilteredExpenses(who,period);return {tags:tagsIn(r.expenses.map(e=>e.description).join(' ')),money:[only(r.expenseSummary.totalExpense)]};}
 if(type==='bill'){const r=await h.load('src/services/database/billDb.ts').getFilteredBills(who,{...period,status:'posted'});return {tags:tagsIn(r.bills.map(b=>b.party_name).join(' ')),money:[only(r.billSummary.totalBilled),only(r.billSummary.totalPaid),only(r.billSummary.totalDue)],count:r.billSummary.billCount};}
 // Stock has no getFiltered*: the on-screen figures are the Stock IN / OUT report screens.
 const api=h.load('src/services/database/stockDb.ts');
 const ins=await api.getStockInReport(who,period.startDate,period.endDate), outs=await api.getStockOutReport(who,period.startDate,period.endDate);
 const valueIn=ins.reduce((a,m)=>a+m.change*(m.cost_per_unit??0),0), valueOut=outs.reduce((a,m)=>a+(-m.change)*(m.sale_price_unit??m.cost_per_unit??0),0);
 return {tags:tagsIn([...ins,...outs].map(m=>m.item_name_en).join(' ')),money:[valueIn,valueOut]};
}
const BOOKS=['cash','expense','bill','stock'];

check(68,'each export preset produces exactly the rows in that period, in PDF and CSV',at('src/components/Download/reportPeriod.ts','presetPeriod'),()=>isolated(async h=>{
 seedPeriods(h);const {presetPeriod}=periodApi(h);const failures=[];
 for(const [preset,tags] of Object.entries(IN_PRESET)){
  const period=presetPeriod(preset,NOW);
  for(const type of BOOKS){const expected=expectTags(bookScope(type,'owner',OWNER_TREE),tags);
   const html=await exportFile(h,type,'owner',period);
   if(JSON.stringify(tagsIn(html))!==JSON.stringify(expected))failures.push(preset+'/'+type+'/pdf: '+tagsIn(html).join(',')+' vs '+expected.join(','));
   const csv=await exportFile(h,type,'owner',period,'csv');
   if(JSON.stringify(tagsIn(csv))!==JSON.stringify(expected))failures.push(preset+'/'+type+'/csv');
   assert.ok(html.includes('Period: '),'PDF states its period');
   if(/DRAFT_|HOLD_/.test(html+csv))failures.push(preset+'/'+type+': draft or hold row exported');
  }
 }
 assert.equal(failures.length,0,failures.join('\n'));
 // The preset bounds themselves, including month-end and a week that crosses a month.
 assert.deepEqual(plain(presetPeriod('today',NOW)),{startDate:'2026-09-11',endDate:'2026-09-11'});
 assert.deepEqual(plain(presetPeriod('week',NOW)),{startDate:'2026-09-05',endDate:'2026-09-11'});
 assert.deepEqual(plain(presetPeriod('month',NOW)),{startDate:'2026-09-01',endDate:'2026-09-30'});
 assert.deepEqual(plain(presetPeriod('week',new Date(2026,9,3,12))),{startDate:'2026-09-27',endDate:'2026-10-03'});
 assert.deepEqual(plain(presetPeriod('month',new Date(2028,1,10,12))),{startDate:'2028-02-01',endDate:'2028-02-29'});
 assert.deepEqual(plain(presetPeriod('custom',NOW)),{});
}));

check(69,'custom range boundaries are inclusive; open ends export everything; bad ranges are refused',at('src/components/Download/reportPeriod.ts','resolvePeriod'),()=>isolated(async h=>{
 seedPeriods(h);
 for(const type of BOOKS){
  const both=await exportFile(h,type,'owner',{startDate:'2026-09-04',endDate:'2026-09-05'});
  const tree=bookScope(type,'owner',OWNER_TREE);
  assert.deepEqual(tagsIn(both),expectTags(tree,['d1','d2']),type+' inclusive boundaries');
  assert.ok(both.includes('Period: '+shown(h,'2026-09-04')+' to '+shown(h,'2026-09-05')),type+' header names both bounds');
  const all=await exportFile(h,type,'owner',{});
  assert.deepEqual(tagsIn(all),expectTags(tree,Object.keys(DAYS)),type+' open range = every row');
  assert.ok(all.includes('Period: all dates'),type+' open range labelled');
  const from=await exportFile(h,type,'owner',{startDate:'2026-09-30'});
  assert.deepEqual(tagsIn(from),expectTags(tree,['d4','d6']),type+' from-only');
  assert.ok(from.includes('Period: from '+shown(h,'2026-09-30')));
  const upTo=await exportFile(h,type,'owner',{endDate:'2026-08-31'});
  assert.deepEqual(tagsIn(upTo),expectTags(tree,['d5']),type+' to-only');
 }
 // A legacy ISO timestamp still resolves to its LOCAL day (old callers passed toISOString()).
 const {resolvePeriod}=periodApi(h);
 assert.deepEqual(plain(resolvePeriod({startDate:'2026-09-04',endDate:'2026-09-05'})),{startDate:'2026-09-04',endDate:'2026-09-05'});
 const iso='2026-09-04T19:30:00.000Z';assert.equal(resolvePeriod({startDate:iso}).startDate,h.load('src/utils/dates.ts').localDate(new Date(iso)),'legacy ISO → local day');
 assert.throws(()=>resolvePeriod({startDate:'2026-99-99'}),/Invalid date range/);
 assert.throws(()=>resolvePeriod({startDate:'garbage'}),/Invalid date range/);
 assert.throws(()=>resolvePeriod({startDate:'2026-09-05',endDate:'2026-09-04'}),/From date must not be after To date/);
 await assert.rejects(exportFile(h,'cash','owner',{startDate:'2026-09-05',endDate:'2026-09-04'}),/From date must not be after To date/);
 await assert.rejects(exportFile(h,'bill','owner',{startDate:'nope'}),/Invalid date range/);
}));

check(70,'report totals are the book\'s own SQL aggregates for the same range',at(pdf,'getFilteredCashHistory(options.userId, period)'),()=>isolated(async h=>{
 seedPeriods(h);const {presetPeriod}=periodApi(h);const fmt=calc(h).formatCurrency;const failures=[];
 const periods=[...Object.keys(IN_PRESET).map(k=>presetPeriod(k,NOW)),{startDate:'2026-09-04',endDate:'2026-09-05'},{}];
 for(const period of periods)for(const type of BOOKS){
  const html=await exportFile(h,type,'owner',period);const book=await bookFigures(h,type,'owner',period);
  if(JSON.stringify(tagsIn(html))!==JSON.stringify(book.tags))failures.push(type+' rows differ for '+JSON.stringify(period));
  for(const paisa of book.money)if(!html.includes('<strong>'+fmt(paisa)+'</strong>'))failures.push(type+' total '+fmt(paisa)+' absent for '+JSON.stringify(period));
  if(book.count!==undefined&&!html.includes('<strong>'+book.count+'</strong>'))failures.push('bill count '+book.count+' absent');
 }
 assert.equal(failures.length,0,failures.join('\n'));
 // Bill export = the Bill Book's default POSTED tab. Drafts and holds are in range and
 // would inflate Total Billed by millions if counted; prove they are not.
 {
  const period=presetPeriod('month',NOW);const html=await exportFile(h,'bill','owner',period);
  const billDbApi=h.load('src/services/database/billDb.ts');
  const posted=(await billDbApi.getFilteredBills('owner',{...period,status:'posted'})).billSummary;
  const every=(await billDbApi.getFilteredBills('owner',{...period,status:'all'})).billSummary;
  assert.ok(only(every.totalBilled)>only(posted.totalBilled)&&every.billCount>posted.billCount,'fixture must contain drafts/holds in range');
  assert.ok(html.includes('<strong>'+fmt(only(posted.totalBilled))+'</strong>'),'Total Billed is the posted figure');
  assert.ok(html.includes('<strong>'+posted.billCount+'</strong>'),'bill count is the posted count');
  assert.ok(!html.includes(fmt(every.totalBilled)),'all-statuses total must not appear');
  assert.ok(!/DRAFT_|HOLD_/.test(html),'no draft/hold rows printed');
  // No paid / unpaid wording on a bill document — Total, Paid and Due say it.
  assert.ok(!/Status/.test(html),'no status column');
 }
 // The cash figure must be a whole-set aggregate, not a sum of the printed page:
 // the book pages at 500, the export is uncapped, so seed past that and compare.
 for(let i=0;i<520;i++)h.insert('cashbook',{id:'bulk'+i,userId:'owner',description:'bulk',amount_paisa:100,direction:'in',date:'2026-09-11',isDeleted:0});
 const html=await exportFile(h,'cash','owner',presetPeriod('today',NOW));const book=await bookFigures(h,'cash','owner',presetPeriod('today',NOW));
 assert.ok(html.includes('<strong>'+fmt(book.money[0])+'</strong>'),'uncapped cash total');
 assert.equal((html.match(/>bulk</g)||[]).length,520,'every row printed');
}));

check(71,'an empty range still produces a valid no-records document with zero totals',at(pdf,'emptyRow'),()=>isolated(async h=>{
 seedPeriods(h);const fmt=calc(h).formatCurrency;
 for(const type of BOOKS){
  const html=await exportFile(h,type,'owner',{startDate:'2025-01-01',endDate:'2025-01-31'});
  assert.match(html,/<html[\s>]/i);assert.ok(html.includes('No records for this period'),type);
  assert.ok(!/{{\w+}}/.test(html),type+' unfilled placeholder');assert.deepEqual(tagsIn(html),[]);
  assert.ok(html.includes('<strong>'+fmt(0)+'</strong>'),type+' zero total');
  assert.ok(html.includes('Period: '+shown(h,'2025-01-01')+' to '+shown(h,'2025-01-31')));
  const csv=await exportFile(h,type,'owner',{startDate:'2025-01-01',endDate:'2025-01-31'},'csv');
  assert.equal(csv.split('\n').filter(Boolean).length,1,type+' CSV is header only');
 }
 // Staff ignores the period entirely: the same roster whatever range is passed.
 const a=await exportFile(h,'staff','owner',{startDate:'2025-01-01',endDate:'2025-01-31'});const b=await exportFile(h,'staff','owner',{});
 assert.equal(a,b,'staff roster must not depend on the period');assert.ok(a.includes('As of '));assert.ok(!a.includes('Period:'));
}));

check(72,'scoping holds inside every range, for every level and the other business (own-only books: exactly the viewer\'s rows)',at(pdf,'hierarchyFilter'),()=>isolated(async h=>{
 seedPeriods(h);const {presetPeriod}=periodApi(h);const failures=[];
 const scope={owner:OWNER_TREE,staffA:['staffA','subA'],subA:['subA'],staffB:['staffB','subB'],otherOwner:['otherStaff'],otherStaff:['otherStaff']};
 for(const [who,tree] of Object.entries(scope))for(const [preset,tags] of Object.entries(IN_PRESET))for(const type of BOOKS){
  const period=presetPeriod(preset,NOW);const html=await exportFile(h,type,who,period);
  const expected=expectTags(bookScope(type,who,tree),tags);
  if(JSON.stringify(tagsIn(html))!==JSON.stringify(expected))failures.push(who+'/'+preset+'/'+type+': '+tagsIn(html).join(',')+' vs '+expected.join(','));
  const book=await bookFigures(h,type,who,period);
  if(JSON.stringify(tagsIn(html))!==JSON.stringify(book.tags))failures.push(who+'/'+preset+'/'+type+' differs from the book screen');
 }
 assert.equal(failures.length,0,failures.join('\n'));
}));

check(73,'the modal drives the query with a real selector; staff hides it; money is paisa-once',at('src/components/Download/DownloadOptionsModal.tsx','DateRangeFilter'),()=>isolated(async h=>{
 const modal=read('src/components/Download/DownloadOptionsModal.tsx');
 assert.ok(!/useState\(new Date\(new Date\(\)\.setDate\(1\)\)/.test(modal),'locked month-to-date state must be gone');
 assert.ok(!modal.includes('this month to date'),'stale label must be gone');
 assert.ok(modal.includes('<DateRangeFilter value={range} onChange={editRange}'),'reuses the shared range control');
 assert.ok(modal.includes('REPORT_PRESETS.map('),'presets are rendered from the shared list');
 assert.ok(/startDate:\s*period\.startDate,\s*endDate:\s*period\.endDate/.test(modal),'the chosen range is what the generator receives');
 assert.ok(/const isRoster = reportType === 'staff'/.test(modal)&&/isRoster \? \(/.test(modal),'staff hides the range control');
 assert.ok(!/console\.log/.test(modal));
 assert.ok(!/\/\s*100\b/.test(read(pdf)),'generator never hand-divides paisa');
 assert.ok(!/\/\s*100\b/.test(read('src/components/Download/reportPeriod.ts')));
 // Money is still formatted once for a chosen range, never raw or divided twice.
 seedPeriods(h);const {presetPeriod}=periodApi(h);
 for(const type of BOOKS){
  const html=await exportFile(h,type,'owner',presetPeriod('today',NOW));
  assert.ok(/Rs\. \d{1,3}(,\d{3})*\.\d{2}/.test(html),type+' formatted money');
  assert.ok(!/Rs\.?\s+Rs\./.test(html),type+' doubled prefix');
  assert.ok(!/>\d{6,}</.test(html),type+' raw paisa cell');
 }
 const csv=await exportFile(h,'cash','owner',presetPeriod('today',NOW),'csv');
 assert.ok(/,1000\.\d\d$/m.test(csv),'CSV rupees with two decimals');assert.ok(!/,100\d{3}$/m.test(csv),'CSV raw paisa');
}));

// ── Prompt 15: customer fields ────────────────────────────────────────────────
const customerDb=h=>h.load('src/services/database/customerDb.ts');
const CNIC='34101-2345678-9', CNIC_DIGITS='3410123456789';
function seedCustomers(h){
 seedPeople(h);
 for(const who of ['owner','staffA','subA','staffB','subB','otherOwner','otherStaff'])
  h.insert('customers',{id:'cust_'+who,user_id:who,name:'CUST_'+who,phone:'0300 000000'+who.length,notes:'legacy note '+who});
}
check(74,'v34 adds the six nullable customer columns and preserves every row across reopen',at(dbPath,'if (version < 34)'),()=>isolated(async h=>{
 seedCustomers(h);
 const cols=h.all('PRAGMA table_info(customers)').map(c=>c.name);
 for(const c of ['photo_local_path','photo_remote_url','email','cnic','address','city'])assert.ok(!cols.includes(c),'v33 must not yet have '+c);
 const before=plain(h.all('SELECT * FROM customers ORDER BY id'));
 // Ceiling 34: this check is about what v34 does, not about 34 being the latest version.
 await h.boot(34);
 assert.equal(h.one('PRAGMA user_version').user_version,34);
 const after=h.all('PRAGMA table_info(customers)');
 for(const c of ['photo_local_path','photo_remote_url','email','cnic','address','city']){const col=after.find(x=>x.name===c);assert.ok(col,'missing '+c);assert.equal(col.notnull,0,c+' must be nullable');}
 const rows=h.all('SELECT * FROM customers ORDER BY id');assert.equal(rows.length,before.length);
 rows.forEach((r,i)=>{for(const [k,v]of Object.entries(before[i]))assert.equal(r[k],v,'customers.'+k);for(const c of ['photo_local_path','photo_remote_url','email','cnic','address','city'])assert.equal(r[c],null,c+' must be null for legacy rows');});
 await h.boot(34);assert.deepEqual(plain(h.all('SELECT * FROM customers ORDER BY id')),plain(rows),'reopen must be a no-op');
},33));
check(75,'every new field saves, round-trips and normalises; only name is required',at('src/services/database/customerDb.ts','normalizeCustomerInput'),()=>isolated(async h=>{
 seedPeople(h);const api=customerDb(h);
 const c=await api.addCustomer({user_id:'staffA',name:'  Ali Khan ',phone:' 0300 1234567 ',email:'Ali@Example.COM',cnic:CNIC_DIGITS,address:' Shop 4, Anarkali ',city:'Lahore',notes:''});
 const row=h.one('SELECT * FROM customers WHERE id=?',c.id);
 assert.equal(row.name,'Ali Khan');assert.equal(row.phone,'0300 1234567');assert.equal(row.email,'ali@example.com');
 assert.equal(row.cnic,CNIC,'bare 13 digits are stored in printed form');assert.equal(row.address,'Shop 4, Anarkali');assert.equal(row.city,'Lahore');assert.equal(row.notes,null,'blank optional becomes null');
 assert.equal(row.photo_local_path,null);assert.equal(row.photo_remote_url,null);
 // Edit path: each field independently updatable and clearable.
 await api.updateCustomer(c.id,'staffA',{city:'Karachi',email:'',cnic:CNIC,address:null});
 const edited=h.one('SELECT * FROM customers WHERE id=?',c.id);
 assert.equal(edited.city,'Karachi');assert.equal(edited.email,null,'cleared');assert.equal(edited.cnic,CNIC);assert.equal(edited.address,null);assert.equal(edited.name,'Ali Khan','untouched field unchanged');
 assert.deepEqual(plain(await api.getCustomerById('staffA',c.id)),plain(edited));
 // Name is the only required field; a bare name is a valid customer.
 const bare=await api.addCustomer({user_id:'staffA',name:'Walk-in Bilal'});const bareRow=h.one('SELECT * FROM customers WHERE id=?',bare.id);
 for(const f of ['phone','email','cnic','address','city','notes'])assert.equal(bareRow[f],null,f);
 await assert.rejects(()=>api.addCustomer({user_id:'staffA',name:'   ',phone:'0300 1234567'}),/customer name/i);
 await assert.rejects(()=>api.updateCustomer(c.id,'staffA',{name:''}),/customer name/i);
 await assert.rejects(()=>api.updateCustomer(c.id,'staffA',{current_balance:0}),/current_balance|not allowed|unexpected/i,'unknown columns are rejected, not silently inserted');
}));
check(76,'CNIC, email and phone accept valid values and reject malformed ones',at('src/utils/contactValidation.ts','normalizeCnic'),()=>isolated(async h=>{
 const v=h.load('src/utils/contactValidation.ts');
 for(const ok of ['34101-2345678-9','3410123456789',' 34101-2345678-9 '])assert.equal(v.normalizeCnic(ok),CNIC,ok);
 assert.equal(v.normalizeCnic(''),null);assert.equal(v.normalizeCnic('   '),null);assert.equal(v.normalizeCnic(null),null);
 for(const bad of ['34101-234567-9','341012345678','34101234567890','34101-2345678-','34101 2345678 9','3410l-2345678-9','12345-1234567-12','abc'])assert.throws(()=>v.normalizeCnic(bad),/13 digits/,bad);
 assert.equal(v.isValidCnic(CNIC),true);assert.equal(v.isValidCnic('123'),false);
 assert.equal(v.normalizeEmail(' Ali.Khan@Example.com '),'ali.khan@example.com');assert.equal(v.normalizeEmail(''),null);
 for(const bad of ['ali','ali@','@example.com','ali@example','ali khan@example.com','ali@@example.com'])assert.throws(()=>v.normalizeEmail(bad),/valid email/,bad);
 for(const ok of ['0300 1234567','03001234567','+92 300 1234567','+923001234567','(042) 1234567'])assert.doesNotThrow(()=>v.normalizePhone(ok),ok);
 for(const bad of ['abc','123','0300-12345678901234','03OO1234567'])assert.throws(()=>v.normalizePhone(bad),/valid phone/,bad);
 // And the data layer enforces the same rules on both add and edit.
 seedPeople(h);const api=customerDb(h);
 await assert.rejects(()=>api.addCustomer({user_id:'owner',name:'X',cnic:'34101-234567-9'}),/13 digits/);
 await assert.rejects(()=>api.addCustomer({user_id:'owner',name:'X',email:'nope'}),/valid email/);
 await assert.rejects(()=>api.addCustomer({user_id:'owner',name:'X',phone:'abc'}),/valid phone/);
 const c=await api.addCustomer({user_id:'owner',name:'X'});
 await assert.rejects(()=>api.updateCustomer(c.id,'owner',{cnic:'1'}),/13 digits/);
 assert.equal(h.one('SELECT COUNT(*) AS n FROM customers').n,1,'rejected saves write nothing');
}));
check(77,'customer photos are copied under documentDirectory and render remote → local → initial',at('src/utils/customerPhoto.ts','persistCustomerPhoto'),()=>isolated(async h=>{
 const photo=h.load('src/utils/customerPhoto.ts');const api=customerDb(h);
 const picked='file:///data/user/0/com.app/cache/ImagePicker/abc.jpg';
 const durable=await photo.persistCustomerPhoto(picked,'cust_1');
 assert.ok(durable.startsWith('test://customer_photos/'),'stored path is under documentDirectory: '+durable);
 assert.ok(!durable.includes('/cache/'),'never the picker cache');
 assert.deepEqual(h.files.map(f=>f.op),['mkdir','copy']);assert.equal(h.files[1].from,picked);assert.equal(h.files[1].to,durable);
 assert.equal(await photo.persistCustomerPhoto(durable,'cust_1'),durable,'already-durable path is reused');assert.equal(h.files.length,2,'no second copy');
 assert.equal(photo.isPersistedCustomerPhoto(picked),false);assert.equal(photo.isPersistedCustomerPhoto(durable),true);
 // Compression options match the receipt pickers.
 const src=read('src/utils/customerPhoto.ts');assert.ok(/quality:\s*0\.5/.test(src));assert.ok(/allowsEditing:\s*true/.test(src));
 // Render chain.
 assert.equal(api.customerPhotoUri({photo_remote_url:'https://x/1.jpg',photo_local_path:durable}),'https://x/1.jpg');
 assert.equal(api.customerPhotoUri({photo_remote_url:null,photo_local_path:durable}),durable);
 assert.equal(api.customerPhotoUri({photo_remote_url:'',photo_local_path:''}),null,'blank falls through to the initial');
 assert.equal(api.customerPhotoUri(null),null);
 const avatar=read('src/components/ui/CustomerAvatar.tsx');
 assert.ok(/onError=\{\(\) => setFailed/.test(avatar),'a missing file drops to the initial');assert.ok(/charAt\(0\)/.test(avatar));
 // Every screen stores ONLY the durable copy in photo_local_path, never a raw picker URI.
 for(const f of ['src/screens/staff/AddCustomerModal.tsx','src/screens/CustomerBook/CustomerBookScreen.tsx']){
  const s=read(f);const assigns=s.match(/photo_local_path:\s*\w+/g)||[];assert.ok(assigns.length>=1,f+' saves a photo');
  for(const a of assigns)assert.ok(/photo_local_path:\s*durable/.test(a),f+' must store the persisted path, got '+a);
  assert.ok(s.includes('persistCustomerPhoto('),f);assert.ok(s.includes('<CustomerAvatar'),f+' renders through the fallback chain');
 }
 assert.ok(read('src/screens/staff/CustomerDetailScreen.tsx').includes('<CustomerAvatar'));
}));
check(78,'CNIC never reaches a log, a sync payload, an export, a PDF or search',at('src/services/database/syncHelpers.ts','LOCAL_ONLY_FIELDS'),()=>isolated(async h=>{
 seedPeople(h);const api=customerDb(h);
 const c=await api.addCustomer({user_id:'owner',name:'Secret Sam',phone:'0300 7654321',cnic:CNIC_DIGITS,email:'sam@example.com'});
 await api.updateCustomer(c.id,'owner',{cnic:CNIC,city:'Multan'});
 assert.equal(h.one('SELECT cnic FROM customers WHERE id=?',c.id).cnic,CNIC,'stored locally');
 const queue=h.all('SELECT * FROM sync_queue WHERE table_name=? ORDER BY created_at','customers');assert.equal(queue.length,2,'create + update queued');
 for(const q of queue){const p=JSON.parse(q.payload);assert.ok(!('cnic' in p),'payload must not carry the cnic key');assert.ok(!q.payload.includes(CNIC)&&!q.payload.includes(CNIC_DIGITS),'payload must not carry the value');assert.equal(p.city??p.name,q.operation==='update'?'Multan':'Secret Sam','other fields still sync');}
 const sync=h.load('src/services/database/syncHelpers.ts');assert.deepEqual(plain(sync.LOCAL_ONLY_FIELDS.customers),['cnic']);
 assert.deepEqual(plain(sync.syncPayloadFor('customers',{a:1,cnic:'x'})),{a:1});assert.deepEqual(plain(sync.syncPayloadFor('bills',{a:1,cnic:'x'})),{a:1,cnic:'x'},'only the declared table is filtered');
 // Logs: everything console.* emitted while writing the customer (with __DEV__ on) is captured.
 assert.ok(h.logs.length>0,'sync helper does log, so the capture works');
 for(const line of h.logs)assert.ok(!line.includes(CNIC)&&!line.includes(CNIC_DIGITS),'CNIC value in a log line: '+line);
 // Search: the customer type reads the customers table by named columns, and nothing matches the CNIC.
 const hits=await h.load('src/services/database/searchDb.ts').executeGlobalSearch(CNIC_DIGITS,'owner');
 assert.equal(hits.length,0);assert.ok(!JSON.stringify(await h.load('src/services/database/searchDb.ts').executeGlobalSearch('Secret','owner')).includes(CNIC));
 // Exports and PDFs: no report reads customers at all, and no export module mentions cnic.
 for(const f of sourceFiles().filter(p=>/components[\\/]Download|utils[\\/]pdfGenerator|searchDb|reports[\\/]/.test(p))){
  const s=fs.readFileSync(f,'utf8');assert.ok(!/cnic/i.test(s),f+' mentions cnic');if(/searchDb/.test(f))assert.ok(!/SELECT \* FROM customers/i.test(s),f+' must name its customer columns');else assert.ok(!/FROM customers/i.test(s),f+' reads customers');
 }
 for(const type of BOOKS){const html=await exportFile(h,type,'owner',{startDate:'2000-01-01',endDate:'2099-12-31'});assert.ok(!html.includes(CNIC)&&!html.includes(CNIC_DIGITS),type);}
 // Source: no console call anywhere names the cnic field, __DEV__ or not.
 for(const f of sourceFiles()){const s=fs.readFileSync(f,'utf8');if(!/cnic/i.test(s))continue;for(const line of s.split('\n'))if(/console\.(log|warn|error|info|debug)/.test(line))assert.ok(!/cnic/i.test(line),f+': '+line.trim());}
 // Pull sync never touches customers, so nothing remote can overwrite the local value.
 assert.ok(!/customers/.test(read('src/services/pullSyncService.ts')));
}));
check(79,'customers are own-only: each account sees exactly the customers it added, by list and by id; parents open a member\'s list read-only through Staff Book',at('src/services/database/customerDb.ts','getCustomerById'),()=>isolated(async h=>{
 seedCustomers(h);const api=customerDb(h);
 const ALL=['cust_owner','cust_staffA','cust_subA','cust_staffB','cust_subB','cust_otherOwner','cust_otherStaff'];
 for(const who of ['owner','staffA','subA','staffB','subB','otherOwner','otherStaff']){
  assert.deepEqual((await api.getCustomers(who)).map(c=>c.id),['cust_'+who],who);
  assert.deepEqual((await api.searchCustomers(who,'',50)).rows.map(c=>c.id),['cust_'+who],who+' search');
  for(const id of ALL)assert.equal((await api.getCustomerById(who,id))?.id??null,id==='cust_'+who?id:null,who+' → '+id);
 }
 // Drill-down: downward only (admin → staff and their sub-staff; staff → own sub-staff).
 // Two levels: every valid drill-down is the owner reaching one of their own staff.
 for(const [viewer,target] of [['owner','staffA'],['owner','subA'],['owner','subB']]){
  assert.deepEqual((await api.searchCustomers(viewer,'',50,null,target)).rows.map(c=>c.id),['cust_'+target],viewer+' views '+target);
  assert.equal((await api.getCustomerById(viewer,'cust_'+target,target))?.id,'cust_'+target);
 }
 // Sideways and upward are refused — including a peer staff member, which is what a
 // former sub-staff's parent now is.
 for(const [viewer,target] of [['staffA','subA'],['staffA','staffB'],['subA','staffA'],['staffA','owner'],['otherOwner','staffA'],['staffB','subA']])
  await assert.rejects(api.searchCustomers(viewer,'',50,null,target),/own team/,viewer+' may not view '+target);
 // Writes are the author's alone — a parent cannot edit a member's customer.
 await assert.rejects(api.updateCustomer('cust_subA','staffA',{city:'X'}),/your own customers/);
 await assert.rejects(api.updateCustomer('cust_subA','owner',{city:'X'}),/your own customers/);
 await api.updateCustomer('cust_subA','subA',{city:'Quetta'});assert.equal(h.one("SELECT city FROM customers WHERE id='cust_subA'").city,'Quetta');
 // Removed customers stay hidden; a removed person's customers stay viewable to their parents.
 h.sqlite.prepare("UPDATE customers SET is_deleted=1 WHERE id='cust_subA'").run();h.sqlite.prepare("UPDATE users SET is_deleted=1 WHERE id='subB'").run();
 assert.deepEqual((await api.searchCustomers('owner','',50,null,'subA')).rows.map(c=>c.id),[]);
 assert.deepEqual((await api.searchCustomers('owner','',50,null,'subB')).rows.map(c=>c.id),['cust_subB']);
 // No customer query scopes by the team any more.
 assert.ok(!/parentId/.test(read('src/services/database/customerDb.ts').replace(/^\s*(\/\/|\*).*$/gm,'')),'customerDb must not scope by the team');
}));
check(80,'both customer forms carry the new fields, the Customer Book can edit, and the bill quick-add no longer crashes','customer screens',()=>{
 const add=read('src/screens/staff/AddCustomerModal.tsx'),book=read('src/screens/CustomerBook/CustomerBookScreen.tsx'),bill=read('src/screens/BillBook/CreateNewBillModal.tsx');
 for(const [f,s]of [['AddCustomerModal',add],['CustomerBookScreen',book]]){
  for(const field of ['email','cnic','address','city','photoUri'])assert.ok(new RegExp('value=\\{'+field+'\\}|uri=\\{'+field+'\\}').test(s),f+' renders '+field);
  assert.ok(/Customer name \*|customerNameLabel'\)\} \*/.test(s),f+' keeps name required (sentence case)');assert.ok(!/console\.log/.test(s),f);
  assert.ok(/keyboardType="email-address"/.test(s)&&/maxLength=\{15\}/.test(s),f+' field affordances');
 }
 // Edit path exists: tapping a card opens the same sheet in edit mode and saves via updateCustomer.
 assert.ok(/<TouchableOpacity style=\{styles\.customerCard\} onPress=\{\(\) => \{ if \(!viewAs\) openEdit\(item\); \}\}/.test(book),'card is tappable (own book; a read-only drill-down cannot edit)');
 assert.ok(/await updateCustomer\(editingId, user\.id, \{ \.\.\.fields, photo_local_path: durable \}\)/.test(book),'edit saves through updateCustomer');
 assert.ok(/t\(editingId \? 'customerEdit' : 'customerAddNew'\)/.test(book),'one sheet, add or edit (sentence case)');
 assert.ok(!/Address \/ Details/.test(book),'the old notes field is no longer mislabelled as address');
 // Quick add in Create Bill: lean by design, and no longer passes a non-existent column.
 assert.ok(!/current_balances*:/.test(bill),'current_balance removed from the insert');assert.ok(/name: newPartyName,\s*phone: newPartyPhone,/.test(bill));
 // Every add path funnels through the one validator.
 assert.ok(read('src/services/database/customerDb.ts').includes('normalizeCustomerInput(fields, { requireName: true })'));
});

check(81,'a sub-staff cannot obtain, set or wipe a CNIC; owner and branch staff read it in full (their own, and downward through Staff Book)',at('src/services/database/customerDb.ts','canViewCnic'),()=>isolated(async h=>{
 seedPeople(h);const api=customerDb(h);
 // canViewCnic is KEPT although the two-level tree makes it constant-true for live
 // accounts — it is the named boundary for who may read a national ID. To prove it still
 // refuses anything below staff, this check restores subA as a LEGACY sub-staff row, the
 // shape a pre-retirement database holds.
 h.sqlite.prepare("UPDATE users SET account_level='substaff', parentId='staffA' WHERE id='subA'").run();
 assert.ok(/CONSTANT-TRUE UNDER THE TWO-LEVEL TREE/.test(read('src/services/database/customerDb.ts')),'and it says so');
 // Branch staff record a CNIC on their own customer.
 const c=await api.addCustomer({user_id:'staffA',name:'Sam Cnic',phone:'0300 1112223'});await api.updateCustomer(c.id,'staffA',{cnic:CNIC});
 assert.equal(await api.canViewCnic('owner'),true);assert.equal(await api.canViewCnic('staffA'),true);assert.equal(await api.canViewCnic('subA'),false);assert.equal(await api.canViewCnic('nobody'),false);
 // Staff read their own in full; the owner reads it in full through the drill-down.
 assert.equal((await api.getCustomerById('staffA',c.id)).cnic,CNIC,'staff byId');assert.equal((await api.getCustomerByName('staffA','Sam Cnic')).cnic,CNIC,'staff byName');
 assert.equal((await api.getCustomers('staffA')).find(x=>x.id===c.id).cnic,CNIC,'staff list');
 assert.equal((await api.getCustomerById('owner',c.id,'staffA')).cnic,CNIC,'owner drill-down byId');
 assert.equal((await api.searchCustomers('owner','',50,null,'staffA')).rows.find(x=>x.id===c.id).cnic,CNIC,'owner drill-down search');
 // A sub-staff's own customer carrying a legacy CNIC: every sub-staff read is redacted.
 h.insert('customers',{id:'sub_c',user_id:'subA',name:'Legacy Sub',phone:'0300 5556667',cnic:CNIC});
 const byId=await api.getCustomerById('subA','sub_c');assert.ok(byId,'sub-staff sees their customer');assert.equal(byId.cnic,null,'sub-staff byId redacted');assert.equal(byId.phone,'0300 5556667','other fields untouched');
 assert.equal((await api.getCustomerByName('subA','Legacy Sub')).cnic,null,'sub-staff byName redacted');
 assert.equal((await api.getCustomers('subA')).find(x=>x.id==='sub_c').cnic,null,'sub-staff list redacted');
 assert.ok(!JSON.stringify(await api.searchCustomers('subA','',50)).includes(CNIC),'no sub-staff read carries the value anywhere');
 // ...while their parents, viewing downward, read it in full.
 assert.equal((await api.getCustomerById('staffA','sub_c','subA')).cnic,CNIC,'branch staff drill-down');
 // Writes mirror the read rule.
 await assert.rejects(()=>api.addCustomer({user_id:'subA',name:'New',cnic:CNIC}),/owner or branch staff/,'sub-staff cannot record one');
 await assert.rejects(()=>api.updateCustomer('sub_c','subA',{cnic:'11111-1111111-1'}),/owner or branch staff/,'sub-staff cannot change one');
 await api.updateCustomer('sub_c','subA',{city:'Sialkot',cnic:''});
 const row=h.one('SELECT * FROM customers WHERE id=?','sub_c');assert.equal(row.city,'Sialkot','sub-staff edits of other fields still save');assert.equal(row.cnic,CNIC,'a blank from a sub-staff form never wipes the stored CNIC');
 await api.updateCustomer(c.id,'staffA',{cnic:''});assert.equal(h.one('SELECT cnic FROM customers WHERE id=?',c.id).cnic,null,'branch staff may clear their own');
 await api.updateCustomer(c.id,'staffA',{cnic:CNIC});assert.equal(h.one('SELECT cnic FROM customers WHERE id=?',c.id).cnic,CNIC);
 assert.equal((await api.getCustomerById('subA','sub_c')).cnic,null);assert.equal(h.one('SELECT cnic FROM customers WHERE id=?','sub_c').cnic,CNIC,'redaction never touches the row');
 // Screens: the field is offered only to those who may see it, and the detail row hides when null.
 for(const f of ['src/screens/staff/AddCustomerModal.tsx','src/screens/CustomerBook/CustomerBookScreen.tsx']){const s=read(f);assert.ok(/canViewCnic\(user\.id\)/.test(s),f);assert.ok(/showCnic &&/.test(s),f+' hides the CNIC field');assert.ok(/\.\.\.\(showCnic \? \{ cnic \} : \{\}\)/.test(s),f+' never sends the key when hidden');}
 assert.ok(/\{customer\.cnic && </.test(read('src/screens/staff/CustomerDetailScreen.tsx')),'detail row is conditional on the (possibly redacted) value');
}));

check(82,'Cash In/Out from a past day lands on THAT day: its Day Book, totals and drift move; today does not',at('src/screens/CashBook/CashEntryModal.tsx','viewedDay'),()=>isolated(async h=>{
 seedPeople(h);h.login('staffA');
 const api=cash(h),closing=closingDb(h);
 const today=h.load('src/utils/dates.ts').todayDate();
 const PAST='2026-09-10';assert.notEqual(PAST,today);
 // The viewed day is closed first, so a late entry must register as drift ON THAT DAY.
 await closing.closeDay(PAST);
 const beforeToday=await api.getDayBook('staffA',today);
 // What the modal does when opened from the Cash Book showing PAST: the date it was handed.
 const entry=await api.createCashEntry('staffA','Forgotten sale',450000,'in',PAST,null,'Sales',null);
 assert.equal(h.one('SELECT date FROM cashbook WHERE id=?',entry.id).date,PAST,'stored on the viewed day');
 const past=await api.getDayBook('staffA',PAST);
 assert.ok(past.entries.some(e=>e.id===entry.id),'appears in the viewed day\'s Day Book');
 assert.equal(past.dayTotals.cashIn,450000);assert.equal(past.dayTotals.entryCount,1);assert.equal(past.dayTotals.net,450000);
 const nowToday=await api.getDayBook('staffA',today);
 assert.ok(!nowToday.entries.some(e=>e.id===entry.id),'absent from today');
 assert.deepEqual(plain(nowToday.dayTotals),plain(beforeToday.dayTotals),'today\'s totals unchanged');
 const pastStatus=await closing.getDayStatus('staffA',PAST);
 assert.equal(pastStatus.drifted,true,'the closed viewed day shows drift');assert.equal(pastStatus.latest.cash_in_paisa,0);assert.equal(pastStatus.current.cashIn,450000);
 assert.equal((await closing.getDayStatus('staffA',today)).drifted,false,'today is not affected');
 // Cash OUT the same way.
 const out=await api.createCashEntry('staffA','Forgotten purchase',120000,'out',PAST,null,'Purchases',null);
 const past2=await api.getDayBook('staffA',PAST);
 assert.equal(past2.dayTotals.cashOut,120000);assert.equal(past2.dayTotals.net,330000);assert.equal(past2.dayTotals.entryCount,2);
 assert.ok(!(await api.getDayBook('staffA',today)).entries.some(e=>e.id===out.id));
 // Wiring: the screen hands the viewed day to BOTH routes; the modal prefills from it and
 // still falls back to today when nothing valid is passed; the field remains editable.
 const screen=read('src/screens/CashBook/CashBookScreen.tsx'),modal=read('src/screens/CashBook/CashEntryModal.tsx');
 assert.ok(/navigate\('CashOutModal', \{ mode: 'out', date: viewDate \}\)/.test(screen),'Cash Out passes viewDate');
 assert.ok(/navigate\('CashInModal', \{ mode: 'in', date: viewDate \}\)/.test(screen),'Cash In passes viewDate');
 assert.ok(/const viewedDay = route\?\.params\?\.date;/.test(modal));
 assert.ok(/viewedDay && isValidDateValue\(viewedDay\) \? viewedDay : todayDate\(\)/.test(modal),'prefill with validated fallback');
 assert.ok(/<DateField[\s\S]{0,200}value=\{date\}[\s\S]{0,120}setDate\(txt\)/.test(modal),'date field kept and editable');
 assert.ok(!/generateCashbookPDF/.test(screen),'legacy JS-summing PDF must not be revived');
 for(const nav of ['src/navigation/AdminNavigator.tsx']){
  const n=read(nav);for(const r of ['CashInModal','CashOutModal'])assert.ok(new RegExp('name="'+r+'" component=\\{CashEntryModal\\}').test(n),nav+' '+r);
 }
}));

check(83,'Cash Book PDF exports exactly the viewed day and reconciles with the Day Book; presets, empty day, scoping and money hold',at('src/components/Download/reportPeriod.ts','initialPeriod'),()=>isolated(async h=>{
 seedPeriods(h);const fmt=calc(h).formatCurrency;const {presetPeriod}=periodApi(h);
 const strong=(html,label)=>{const m=new RegExp(label+': <strong>([^<]+)</strong>').exec(html);assert.ok(m,label+' missing');return m[1];};
 // 1. Every viewed day, for every level: the PDF rows are that day's Day Book rows and the
 //    three totals are getDayBook's SQL aggregate — cash in, cash out AND net.
 const failures=[];
 for(const who of ['owner','staffA','subA','staffB','otherOwner']){
  for(const [tag,day] of Object.entries(DAYS)){
   const html=await exportFile(h,'cash',who,{startDate:day,endDate:day});
   const book=await cash(h).getDayBook(who,day);
   const expected=sorted(book.entries.map(e=>e.description)),got=tagsIn(html);
   if(JSON.stringify(expected)!==JSON.stringify(got))failures.push(who+'/'+day+' rows: '+expected+' vs '+got);
   if(strong(html,'Total in')!==fmt(book.dayTotals.cashIn))failures.push(who+'/'+day+' in');
   if(strong(html,'Total out')!==fmt(book.dayTotals.cashOut))failures.push(who+'/'+day+' out');
   if(strong(html,'Net balance')!==fmt(book.dayTotals.net))failures.push(who+'/'+day+' net');
   if(book.entries.length===0&&!html.includes('No records for this period'))failures.push(who+'/'+day+' empty doc');
   if(/Rs\.?\s+Rs\./.test(html))failures.push(who+'/'+day+' doubled prefix');
   if(/>\d{6,}</.test(html))failures.push(who+'/'+day+' raw paisa');
  }
 }
 assert.equal(failures.length,0,failures.join('\n'));
 // 2. A day with nothing on it anywhere produces the no-records document with zero totals.
 const empty=await exportFile(h,'cash','owner',{startDate:'2026-07-04',endDate:'2026-07-04'});
 assert.ok(empty.includes('No records for this period'));assert.equal(strong(empty,'Total in'),fmt(0));assert.equal(strong(empty,'Net balance'),fmt(0));
 // 3. A deleted entry on the viewed day is neither listed nor counted — same rule as the screen.
 h.sqlite.prepare("UPDATE cashbook SET isDeleted=1 WHERE id='cash_ROW_staffA_d0'").run();
 const afterDelete=await exportFile(h,'cash','staffA',{startDate:DAYS.d0,endDate:DAYS.d0});
 assert.ok(!afterDelete.includes('ROW_staffA_d0'));assert.equal(strong(afterDelete,'Total in'),fmt((await cash(h).getDayBook('staffA',DAYS.d0)).dayTotals.cashIn));
 // 4. Switching to a preset from the sheet exports that range, reconciling with Cash History.
 for(const preset of ['today','week','month']){
  const period=presetPeriod(preset,NOW);const html=await exportFile(h,'cash','owner',period);
  const hist=await cash(h).getFilteredCashHistory('owner',period);
  assert.deepEqual(tagsIn(html),sorted(hist.entries.map(e=>e.description)),preset+' rows');
  assert.equal(strong(html,'Net balance'),fmt(hist.cashSummary.cashBalance),preset+' net');
  assert.deepEqual(tagsIn(html),expectTags(['owner'],IN_PRESET[preset]),preset+' preset membership (own-only)');
 }
 // 5. The sheet's starting period: the viewed day itself; today → the Today pill; nothing → month.
 const {initialPeriod}=periodApi(h);
 const today=h.load('src/utils/dates.ts').todayDate();
 assert.deepEqual(plain(initialPeriod('2026-09-10')),{preset:'custom',range:{startDate:'2026-09-10',endDate:'2026-09-10'}});
 assert.deepEqual(plain(initialPeriod(today)),{preset:'today',range:{startDate:today,endDate:today}});
 assert.equal(initialPeriod(undefined).preset,'month');assert.equal(initialPeriod('2026-99-99').preset,'month','invalid day falls back');
 // 6. Wiring: Bill Book's exact button, opening the sheet with the viewed day; no legacy generator; route in both stacks.
 const screen=read('src/screens/CashBook/CashBookScreen.tsx'),bill=read('src/screens/BillBook/BillBookScreen.tsx');
 assert.ok(screen.includes("navigation.navigate('DownloadOptionsModal', { reportType: 'cash', date: viewDate })"),'button passes the viewed day');
 // ONE shared PDF button for Cash, Bill and Stock (PdfReportButton), so the three can't drift apart
 // again. Each screen renders it, and only the export it opens differs.
 const stockScreen=read('src/screens/StockBook/StockBookScreen.tsx'),shared=read('src/components/ui/PdfReportButton.tsx');
 assert.ok(screen.includes("<PdfReportButton onPress={() => navigation.navigate('DownloadOptionsModal', { reportType: 'cash', date: viewDate })} />"),'Cash uses the shared button with the viewed day');
 assert.ok(bill.includes("<PdfReportButton onPress={() => navigation.navigate('DownloadOptionsModal', { reportType: 'bill' })} />"),'Bill uses the shared button');
 assert.ok(stockScreen.includes("<PdfReportButton onPress={() => navigation.navigate('DownloadOptionsModal', { reportType: 'stock' })} />"),'Stock uses the shared button');
 for(const src of [screen,bill,stockScreen])assert.ok(!/PDF Report|⬇/.test(src),'no hand-rolled PDF button left');
 assert.ok(/<Icon name="download"/.test(shared)&&/t\('staffPdfReport'\)\}<\/Text>/.test(shared)&&/minHeight: touchTarget/.test(shared),'shared button: Feather icon, sentence case, 44px');
 assert.equal((shared.match(/#[0-9A-Fa-f]{3,6}\b/g)||[]).length,0,'tokens only');
 assert.ok(!/generateCashbookPDF/.test(screen));
 for(const nav of ['src/navigation/AdminNavigator.tsx']){
  const n=read(nav);const stack=n.slice(n.indexOf('name="CashBook"'),n.indexOf('</Stack.Navigator>',n.indexOf('name="CashBook"')));
  assert.ok(stack.includes('name="DownloadOptionsModal"'),nav+': modal must sit in the Cash Book\'s own stack');
 }
}));

check(84,'Stock IN/OUT report exports cover exactly the screen\'s range and direction, totals match the screen, print and export share one path',at('src/services/database/stockDb.ts','getStockMovementReport'),()=>isolated(async h=>{
 seedPeriods(h);const fmt=calc(h).formatCurrency;const stock=h.load('src/services/database/stockDb.ts');
 // A parent-owned item moved by a sub-staff, a deleted movement, and a movement on a deleted item.
 h.insert('stock_items',{id:'item_cross',user_id:'staffA',name_en:'ROW_cross_d0',purchase_price:1,sale_price:1,quantity:5});
 h.insert('stock_movements',{id:'mv_cross',user_id:'subA',item_id:'item_cross',change:3,cost_per_unit:12345,sale_price_unit:null,date:DAYS.d0});
 h.insert('stock_movements',{id:'mv_gone',user_id:'staffA',item_id:'item_cross',change:9,cost_per_unit:99999,date:DAYS.d0,is_deleted:1});
 h.insert('stock_items',{id:'item_dead',user_id:'staffA',name_en:'ROW_dead_d0',purchase_price:1,sale_price:1,quantity:5,is_deleted:1});
 h.insert('stock_movements',{id:'mv_dead',user_id:'staffA',item_id:'item_dead',change:-4,sale_price_unit:77777,date:DAYS.d0});
 // What the screens compute from their loaded rows (unpaginated JS reduce) — the PDF must equal it.
 const screenTotals=(rows,dir)=>({entries:rows.length,qty:rows.reduce((s,r)=>s+Math.abs(r.change),0),
  amount:rows.reduce((s,r)=>s+Math.abs(r.change)*(dir==='in'?(r.cost_per_unit||0):(r.sale_price_unit||r.cost_per_unit||0)),0)});
 const strong=(html,label)=>{const m=new RegExp(label+': <strong>([^<]+)</strong>').exec(html);assert.ok(m,label+' missing');return m[1];};
 const ranges=[{startDate:DAYS.d0,endDate:DAYS.d0},{startDate:DAYS.d3,endDate:DAYS.d4},{startDate:DAYS.d1},{endDate:DAYS.d2},{}];
 const failures=[];
 for(const who of ['owner','staffA','subA','staffB','otherOwner'])for(const dir of ['in','out'])for(const range of ranges){
  const screenRows=await (dir==='in'?stock.getStockInReport:stock.getStockOutReport)(who,range.startDate,range.endDate);
  const {rows,summary}=await stock.getStockMovementReport(who,dir,range.startDate,range.endDate);
  const expected=screenTotals(screenRows,dir);
  if(JSON.stringify(plain(rows))!==JSON.stringify(plain(screenRows)))failures.push(who+'/'+dir+' rows differ from the screen query');
  if(JSON.stringify(plain(summary))!==JSON.stringify(expected))failures.push(who+'/'+dir+'/'+JSON.stringify(range)+' SQL summary '+JSON.stringify(summary)+' vs screen '+JSON.stringify(expected));
  for(const r of rows){if(dir==='in'&&r.change<=0)failures.push('IN report has a non-positive movement');if(dir==='out'&&r.change>=0)failures.push('OUT report has a non-negative movement');}
  const type=dir==='in'?'stockIn':'stockOut';const html=await exportFile(h,type,who,range);
  const tags=sorted(new Set(html.match(/ROW_[A-Za-z]+_d\d/g)||[]));
  if(JSON.stringify(tags)!==JSON.stringify(sorted(new Set(rows.map(r=>r.item_name_en)))))failures.push(who+'/'+type+' PDF rows: '+tags);
  if(!html.includes('Stock '+dir+' report'))failures.push(type+' not labelled as '+dir);
  if(html.includes('Stock '+(dir==='in'?'out':'in')+' report'))failures.push(type+' labelled as the other direction');
  if(strong(html,'Entries')!==String(expected.entries)||strong(html,'Total qty '+dir)!==String(expected.qty))failures.push(who+'/'+type+' counts');
  if(strong(html,'Total amount \\('+(dir==='in'?'purchase value':'sale value')+'\\)')!==fmt(expected.amount))failures.push(who+'/'+type+' amount');
  if(rows.length===0&&!html.includes('No records for this period'))failures.push(who+'/'+type+' empty doc');
  if(/Rs\.?\s+Rs\./.test(html))failures.push(type+' doubled prefix');if(/>\d{6,}</.test(html))failures.push(type+' raw paisa');
  const csv=await exportFile(h,type,who,range,'csv');if(rows.length&&!/,\d+\.\d\d$/m.test(csv))failures.push(type+' CSV rupees');
 }
 assert.equal(failures.length,0,failures.join('\n'));
 // Scoping and exclusions on the specific fixtures.
 const staffIn=(await stock.getStockMovementReport('staffA','in',DAYS.d0,DAYS.d0)).rows.map(r=>r.id);
 assert.ok(staffIn.includes('mv_cross'),'sub-staff movement on the parent\'s item counts for the parent');
 assert.ok(!staffIn.includes('mv_gone'),'deleted movement excluded');
 assert.ok(!(await stock.getStockMovementReport('staffA','out',DAYS.d0,DAYS.d0)).rows.some(r=>r.id==='mv_dead'),'movement on a deleted item excluded');
 assert.ok(!(await stock.getStockMovementReport('staffB','in',DAYS.d0,DAYS.d0)).rows.some(r=>r.id==='mv_cross'),'other branch cannot see it');
 await assert.rejects(()=>stock.getStockMovementReport('owner','in','2026-09-30','2026-09-01'),/From date/);
 await assert.rejects(()=>stock.getStockMovementReport('owner','in','nope'),/Invalid date/);
 // The sheet opens on the range the screen was showing, open ends included.
 const {initialPeriod}=periodApi(h);
 assert.deepEqual(plain(initialPeriod(undefined,{startDate:'2026-09-01',endDate:'2026-09-30'})),{preset:'custom',range:{startDate:'2026-09-01',endDate:'2026-09-30'}});
 assert.deepEqual(plain(initialPeriod(undefined,{startDate:'2026-09-05'})),{preset:'custom',range:{startDate:'2026-09-05'}});
 assert.equal(initialPeriod(undefined,{}).preset,'month','"All Time" on the screen leaves the default');
 // Wiring: no dead buttons, both screens export their own range and print through the same generator.
 for(const [f,type] of [['src/screens/StockBook/StockInReportScreen.tsx','stockIn'],['src/screens/StockBook/StockOutReportScreen.tsx','stockOut']]){
  const src=read(f);
  assert.ok(!/coming soon/i.test(src),f+' still has a coming-soon button');
  assert.ok(src.includes("navigation.navigate('DownloadOptionsModal', { reportType: '"+type+"', period: shownPeriod() })"),f+' export');
  assert.ok(src.includes("generateFile({ reportType: '"+type+"', userId: user.id, ...shownPeriod(), format: 'pdf' })")&&src.includes('Print.printAsync({ uri })'),f+' print');
  assert.ok(/onPress=\{handleExport\}/.test(src)&&/onPress=\{handlePrint\}/.test(src),f+' buttons wired');
 }
 for(const nav of ['src/navigation/AdminNavigator.tsx']){
  const n=read(nav);const i=n.indexOf('name="StockInReportScreen"');const stack=n.slice(n.lastIndexOf('<Stack.Navigator',i),n.indexOf('</Stack.Navigator>',i));
  assert.ok(stack.includes('name="StockOutReportScreen"')&&stack.includes('name="DownloadOptionsModal"'),nav+': modal must sit in the report screens\' stack');
 }
 // The top-level Stock Book button is untouched and its month preset is the whole calendar month.
 assert.ok(read('src/screens/StockBook/StockBookScreen.tsx').includes("navigation.navigate('DownloadOptionsModal', { reportType: 'stock' })"));
 assert.deepEqual(plain(periodApi(h).presetPeriod('month',NOW)),{startDate:'2026-09-01',endDate:'2026-09-30'});
}));

// ── List scaling, stage 1: Cash History keyset paging + day subtotals ─────────
function seedBigCash(h){
 seedPeople(h);const rows=[];let n=0;
 // ~4,200 rows over 120 days across the owner tree (+ another business), with shared
 // (date, createdAt) pairs so the id tiebreak matters, and a sprinkling of deleted rows.
 for(const who of ['owner','staffA','subA','staffB','subB','otherStaff'])for(let d=0;d<120;d++){
  const day=new Date(2026,8,30-d,12),date=localDay(day);
  const perDay=who==='owner'?9:who==='otherStaff'?3:6;
  for(let k=0;k<perDay;k++){
   n++;const createdAt=date+'T'+String(8+(k%6)).padStart(2,'0')+':00:00.000Z';
   const row={id:'big_'+String(n).padStart(5,'0'),userId:who,description:'D'+d+'K'+k+(k===2?' NEEDLE':''),amount_paisa:1000+n,direction:k%3?'in':'out',date,createdAt,isDeleted:n%17===0?1:0};
   h.insert('cashbook',row);rows.push(row);
  }
 }
 return rows;
}
const localDay=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const keyOf=r=>[r.date,r.createdAt||'',r.id];
const after=(a,b)=>{for(let i=0;i<3;i++){if(a[i]<b[i])return false;if(a[i]>b[i])return true;}return false;};
async function pageAll(h,viewer,filter,limit=50,startCursor=null){
 const pages=[];let cursor=startCursor;let guard=0;
 do{const page=await cash(h).getFilteredCashHistory(viewer,filter,limit,0,cursor);pages.push(page);cursor=page.nextCursor;assert.ok(++guard<500,'runaway paging');}while(cursor);
 return pages;
}
check(85,'Cash History: totals byte-identical at 1 vs N pages on 4,000+ rows; every row once; day subtotals are SQL; scoping/deletion on every page; insert and delete mid-scroll are safe',at('src/services/database/pagination.ts','keysetClause'),()=>isolated(async h=>{
 const rows=seedBigCash(h);assert.ok(rows.length>4000,'fixture size '+rows.length);
 const scopes={owner:['owner'],staffA:['staffA'],subA:['subA']};
 const filters=[{},{startDate:'2026-09-01',endDate:'2026-09-30'},{direction:'out'},{search:'needle'},{startDate:'2026-08-01',endDate:'2026-08-31',direction:'in'}];
 const failures=[];
 for(const [viewer,scope] of Object.entries(scopes))for(const filter of filters){
  const inRange=r=>(!filter.startDate||r.date>=filter.startDate)&&(!filter.endDate||r.date<=filter.endDate);
  const expected=rows.filter(r=>scope.includes(r.userId)&&!r.isDeleted&&inRange(r)&&(!filter.direction||filter.direction==='all'||r.direction===filter.direction)&&(!filter.search||r.description.toLowerCase().includes(filter.search)));
  const expectedIds=new Set(expected.map(r=>r.id));
  const uncapped=await cash(h).getFilteredCashHistory(viewer,filter);
  assert.equal(uncapped.nextCursor,null,'uncapped query has no cursor');
  const pages=await pageAll(h,viewer,filter);
  const label=viewer+' '+JSON.stringify(filter)+' ('+expected.length+' rows, '+pages.length+' pages)';
  // 1. Totals: identical on every page, identical to the uncapped query, identical to the fixture.
  const t0=JSON.stringify(plain(pages[0].cashSummary));
  for(const pg of pages)if(JSON.stringify(plain(pg.cashSummary))!==t0)failures.push(label+': summary changed between pages');
  if(t0!==JSON.stringify(plain(uncapped.cashSummary)))failures.push(label+': paged summary differs from uncapped');
  const fixIn=expected.filter(r=>r.direction==='in').reduce((a,r)=>a+r.amount_paisa,0),fixOut=expected.filter(r=>r.direction==='out').reduce((a,r)=>a+r.amount_paisa,0);
  if(t0!==JSON.stringify({cashIn:fixIn,cashOut:fixOut,cashBalance:fixIn-fixOut}))failures.push(label+': summary '+t0+' vs fixture in='+fixIn+' out='+fixOut);
  // 2. Every row exactly once, strictly descending across page boundaries, last row reached.
  const seen=[];for(const pg of pages)for(const e of pg.entries)seen.push(e);
  const ids=seen.map(e=>e.id);
  if(new Set(ids).size!==ids.length)failures.push(label+': duplicate rows across pages');
  if(ids.length!==expected.length)failures.push(label+': paged '+ids.length+' rows, expected '+expected.length);
  for(const id of ids)if(!expectedIds.has(id))failures.push(label+': out-of-scope or deleted row '+id+' on a page');
  for(let i=1;i<seen.length;i++)if(!after(keyOf(seen[i-1]),keyOf(seen[i])))failures.push(label+': order broke at '+seen[i].id);
  if(JSON.stringify(ids)!==JSON.stringify(uncapped.entries.map(e=>e.id)))failures.push(label+': paged sequence differs from the uncapped sequence');
  for(const pg of pages.slice(0,-1))if(pg.entries.length!==50)failures.push(label+': a non-final page was short');
  // 3. Day subtotals: one SQL query, equal to the fixture's per-day sums, one row per day present.
  const days=await cash(h).getCashHistoryDayTotals(viewer,filter);
  const byDay={};for(const r of expected){const d=byDay[r.date]||(byDay[r.date]={cashIn:0,cashOut:0,entryCount:0});d[r.direction==='in'?'cashIn':'cashOut']+=r.amount_paisa;d.entryCount++;}
  if(days.length!==Object.keys(byDay).length)failures.push(label+': '+days.length+' day rows vs '+Object.keys(byDay).length+' days');
  for(const d of days){const e=byDay[d.day];if(!e||e.cashIn!==d.cashIn||e.cashOut!==d.cashOut||e.entryCount!==d.entryCount)failures.push(label+': day '+d.day+' subtotal '+JSON.stringify(plain(d))+' vs '+JSON.stringify(e));}
  for(let i=1;i<days.length;i++)if(days[i-1].day<=days[i].day)failures.push(label+': day totals not newest-first');
 }
 assert.equal(failures.length,0,failures.join('\n'));
 // 4. A day straddling a page boundary: its header figure comes from the day query, not the page.
 const first=(await pageAll(h,'owner',{},50));const cut=first[0].entries.at(-1).date;
 const straddles=first[0].entries.filter(e=>e.date===cut).length+first[1].entries.filter(e=>e.date===cut).length;
 const dayRow=(await cash(h).getCashHistoryDayTotals('owner',{})).find(d=>d.day===cut);
 assert.ok(first[1].entries.some(e=>e.date===cut),'fixture must straddle a boundary');
 assert.equal(dayRow.entryCount,straddles,'the straddling day\'s subtotal counts rows on BOTH pages');
 assert.ok(dayRow.entryCount>first[0].entries.filter(e=>e.date===cut).length,'…not just the ones loaded first');
 // 5. Insert mid-scroll: two pages loaded, then a NEW newest row and a new row inside the
 //    unloaded range appear. Keyset: the newest never leaks into later pages (no duplicate),
 //    the older one appears exactly once, the sequence stays strictly descending.
 const before=await pageAll(h,'owner',{});const allBefore=before.flatMap(p=>p.entries.map(e=>e.id));
 const two=[];let cur=null;for(let i=0;i<2;i++){const pg=await cash(h).getFilteredCashHistory('owner',{},50,0,cur);two.push(pg);cur=pg.nextCursor;}
 const loaded=two.flatMap(p=>p.entries);const lastLoaded=loaded.at(-1);
 h.insert('cashbook',{id:'new_newest',userId:'owner',description:'late',amount_paisa:5,direction:'in',date:'2026-09-30',createdAt:'2026-09-30T23:59:59.000Z',isDeleted:0});
 const olderDate=localDay(new Date(2026,8,30-60));
 h.insert('cashbook',{id:'new_older',userId:'owner',description:'backdated',amount_paisa:7,direction:'out',date:olderDate,createdAt:olderDate+'T00:00:01.000Z',isDeleted:0});
 assert.ok(after(keyOf(lastLoaded),[olderDate,olderDate+'T00:00:01.000Z','new_older']),'backdated row must fall inside the unloaded range');
 const rest=await pageAll(h,'owner',{},50,cur);const restIds=rest.flatMap(p=>p.entries.map(e=>e.id));
 const seq=[...loaded,...rest.flatMap(p=>p.entries)];
 assert.ok(!restIds.includes('new_newest'),'a row newer than the cursor never appears on a later page');
 assert.equal(restIds.filter(id=>id==='new_older').length,1,'a row inserted inside the unloaded range appears exactly once');
 assert.equal(new Set(seq.map(e=>e.id)).size,seq.length,'no duplicates after the insert');
 for(let i=1;i<seq.length;i++)assert.ok(after(keyOf(seq[i-1]),keyOf(seq[i])),'order held after the insert');
 assert.deepEqual(seq.map(e=>e.id).filter(id=>id!=='new_older'),allBefore,'every original row still exactly once');
 // Totals on the continued pages already include BOTH inserts — the summary is never paged.
 for(const pg of rest)assert.equal(pg.cashSummary.cashIn,before[0].cashSummary.cashIn+5);
 // A fresh load from the top shows both.
 const reload=await pageAll(h,'owner',{});const reIds=reload.flatMap(p=>p.entries.map(e=>e.id));
 assert.equal(reIds[0],'new_newest');assert.ok(reIds.includes('new_older'));assert.equal(reIds.length,allBefore.length+2);
 // 6. Delete mid-scroll: soft-deleting an already-loaded row does not skip anything on later pages.
 const two2=[];cur=null;for(let i=0;i<2;i++){const pg=await cash(h).getFilteredCashHistory('owner',{},50,0,cur);two2.push(pg);cur=pg.nextCursor;}
 const expectedRest=(await pageAll(h,'owner',{},50,cur)).flatMap(p=>p.entries.map(e=>e.id));
 h.sqlite.prepare('UPDATE cashbook SET isDeleted=1 WHERE id=?').run(two2[0].entries[3].id);
 const afterDelete=(await pageAll(h,'owner',{},50,cur)).flatMap(p=>p.entries.map(e=>e.id));
 assert.deepEqual(afterDelete,expectedRest,'later pages unchanged by a deletion above the cursor');
 // 7. Legacy limit/offset path still works and reports no cursor beyond the end.
 const nowIds=(await pageAll(h,'owner',{})).flatMap(p=>p.entries.map(e=>e.id));
 const off=await cash(h).getFilteredCashHistory('owner',{},50,50);assert.equal(off.entries.length,50);assert.deepEqual(off.entries.map(e=>e.id),nowIds.slice(50,100));
 // 8. Source: cursor on the rows query only; aggregates keep the plain WHERE; the screen pages and groups.
 const db=read('src/services/database/cashbookDb.ts');
 assert.ok(/SELECT \* FROM cashbook WHERE \$\{rowsWhere\}/.test(db),'rows query uses the cursored WHERE');
 const hist=db.slice(db.indexOf('export const getFilteredCashHistory'),db.indexOf('export const createCashEntry'));
 assert.equal((hist.match(/FROM cashbook WHERE \$\{where\}/g)||[]).length,2,'summary and day-totals use the un-cursored WHERE');
 assert.equal((hist.match(/rowsWhere/g)||[]).length,2,'only the rows query is cursored');
 assert.ok(/GROUP BY date\(date\)/.test(db));assert.ok(!/keysetClause\([^)]*\)[^\n]*SUM/.test(db));
 const screen=read('src/screens/CashBook/CashHistory.tsx');
 assert.ok(/<SectionList[\s\S]*stickySectionHeadersEnabled[\s\S]*onEndReached=\{loadMore\}/.test(screen),'SectionList with sticky headers and load-more');
 assert.ok(!/<FlatList/.test(screen));assert.ok(/useState<DateRange>\(\(\) => thisMonthRange\(\)\)/.test(screen),'opens on this month');
 assert.ok(/getCashHistoryDayTotals\(user\.id, activeFilter\)/.test(screen)&&!/getCashHistoryDayTotals[^\n]*cursor/.test(screen),'day totals fetched per filter, never per page');
 assert.ok(/getFilteredCashHistory\(user\.id, activeFilter, PAGE_SIZE, 0, cursor\)/.test(screen),'next page uses the cursor');
 assert.ok(!/\.reduce\(/.test(screen),'no on-screen summing');
 assert.ok(/<DateRangeFilter value=\{range\}/.test(screen),'range control stays visible');
 assert.equal(h.load('src/services/database/pagination.ts').PAGE_SIZE,50);
 assert.deepEqual(plain(h.load('src/utils/dates.ts').thisMonthRange(new Date(2026,8,15))),{startDate:'2026-09-01',endDate:'2026-09-30'});
}));

// ── List scaling, stage 2: Khata keyset paging + day subtotals ───────────────
function seedBigKhata(h){
 seedPeople(h);const rows=[];let n=0;const parties=['Ali Traders','Bilal Store','Chand Foods','Danish Mart'];
 for(const who of ['owner','staffA','subA','staffB','subB','otherStaff'])for(let d=0;d<120;d++){
  const day=new Date(2026,8,30-d,12),date=localDay(day);
  const perDay=who==='owner'?9:who==='otherStaff'?3:6;
  for(let k=0;k<perDay;k++){
   n++;const createdAt=date+'T'+String(8+(k%6)).padStart(2,'0')+':00:00.000Z';
   const row={id:'kh_'+String(n).padStart(5,'0'),userId:who,partyName:parties[(d+k)%parties.length],amount_paisa:1000+n,type:k%3?'lena':'dena',notes:k===2?'needle note':'n',date,createdAt,isDeleted:n%17===0?1:0};
   h.insert('transactions',row);rows.push(row);
  }
 }
 return rows;
}
async function pageKhata(h,viewer,filter,limit=50,startCursor=null){
 const pages=[];let cursor=startCursor;let guard=0;
 do{const page=await khata(h).getFilteredKhata(viewer,filter,limit,0,cursor);pages.push(page);cursor=page.nextCursor;assert.ok(++guard<500,'runaway paging');}while(cursor);
 return pages;
}
check(86,'Khata: totals byte-identical at 1 vs N pages on 4,000+ rows; every row once; day subtotals are SQL; pills zero out; ledger balances are all-time regardless of the range',at('src/services/database/transactionDb.ts','getKhataDayTotals'),()=>isolated(async h=>{
 const rows=seedBigKhata(h);assert.ok(rows.length>4000);
 const scopes={owner:['owner'],staffA:['staffA'],subA:['subA']}; // own-only
 const filters=[{},{startDate:'2026-09-01',endDate:'2026-09-30'},{type:'lena'},{type:'dena',startDate:'2026-08-01',endDate:'2026-08-31'},{search:'bilal'},{search:'needle',type:'lena'}];
 const failures=[];
 for(const [viewer,scope] of Object.entries(scopes))for(const filter of filters){
  const inRange=r=>(!filter.startDate||r.date>=filter.startDate)&&(!filter.endDate||r.date<=filter.endDate);
  const expected=rows.filter(r=>scope.includes(r.userId)&&!r.isDeleted&&inRange(r)&&(!filter.type||filter.type==='all'||r.type===filter.type)&&(!filter.search||(r.partyName+' '+r.notes).toLowerCase().includes(filter.search)));
  const expectedIds=new Set(expected.map(r=>r.id));
  const uncapped=await khata(h).getFilteredKhata(viewer,filter);assert.equal(uncapped.nextCursor,null);
  const pages=await pageKhata(h,viewer,filter);
  const label=viewer+' '+JSON.stringify(filter)+' ('+expected.length+' rows, '+pages.length+' pages)';
  const t0=JSON.stringify(plain(pages[0].balanceSummary));
  for(const pg of pages)if(JSON.stringify(plain(pg.balanceSummary))!==t0)failures.push(label+': summary changed between pages');
  if(t0!==JSON.stringify(plain(uncapped.balanceSummary)))failures.push(label+': paged summary differs from uncapped');
  const lena=expected.filter(r=>r.type==='lena').reduce((a,r)=>a+r.amount_paisa,0),dena=expected.filter(r=>r.type==='dena').reduce((a,r)=>a+r.amount_paisa,0);
  if(t0!==JSON.stringify({totalLena:lena,totalDena:dena,netBalance:lena-dena}))failures.push(label+': summary '+t0+' vs fixture');
  // Type pills zero out under paging, on every page.
  if(filter.type==='lena')for(const pg of pages)if(pg.balanceSummary.totalDena!==0)failures.push(label+': Dena must be 0 under the Lena pill');
  if(filter.type==='dena')for(const pg of pages)if(pg.balanceSummary.totalLena!==0)failures.push(label+': Lena must be 0 under the Dena pill');
  const seen=pages.flatMap(pg=>pg.transactions);const ids=seen.map(e=>e.id);
  if(new Set(ids).size!==ids.length)failures.push(label+': duplicates');
  if(ids.length!==expected.length)failures.push(label+': paged '+ids.length+' vs expected '+expected.length);
  for(const id of ids)if(!expectedIds.has(id))failures.push(label+': out-of-scope/deleted/mistyped row '+id);
  for(let i=1;i<seen.length;i++)if(!after(keyOf(seen[i-1]),keyOf(seen[i])))failures.push(label+': order broke at '+seen[i].id);
  if(JSON.stringify(ids)!==JSON.stringify(uncapped.transactions.map(e=>e.id)))failures.push(label+': paged sequence differs from uncapped');
  for(const pg of pages.slice(0,-1))if(pg.transactions.length!==50)failures.push(label+': short non-final page');
  const days=await khata(h).getKhataDayTotals(viewer,filter);
  const byDay={};for(const r of expected){const d=byDay[r.date]||(byDay[r.date]={lena:0,dena:0,entryCount:0});d[r.type]+=r.amount_paisa;d.entryCount++;}
  if(days.length!==Object.keys(byDay).length)failures.push(label+': day rows '+days.length+' vs '+Object.keys(byDay).length);
  for(const d of days){const e=byDay[d.day];if(!e||e.lena!==d.lena||e.dena!==d.dena||e.entryCount!==d.entryCount)failures.push(label+': day '+d.day+' '+JSON.stringify(plain(d))+' vs '+JSON.stringify(e));}
 }
 assert.equal(failures.length,0,failures.join('\n'));
 // Straddling day: header figure from the day query covers rows on both pages.
 const first=await pageKhata(h,'owner',{});const cut=first[0].transactions.at(-1).date;
 assert.ok(first[1].transactions.some(t=>t.date===cut),'fixture straddles a boundary');
 const dayRow=(await khata(h).getKhataDayTotals('owner',{})).find(d=>d.day===cut);
 assert.equal(dayRow.entryCount,first[0].transactions.filter(t=>t.date===cut).length+first[1].transactions.filter(t=>t.date===cut).length);
 // Insert mid-scroll.
 const before=await pageKhata(h,'owner',{});const allBefore=before.flatMap(p=>p.transactions.map(e=>e.id));
 const two=[];let cur=null;for(let i=0;i<2;i++){const pg=await khata(h).getFilteredKhata('owner',{},50,0,cur);two.push(pg);cur=pg.nextCursor;}
 const loaded=two.flatMap(p=>p.transactions);
 h.insert('transactions',{id:'kh_newest',userId:'owner',partyName:'Late Party',amount_paisa:5,type:'lena',date:'2026-09-30',createdAt:'2026-09-30T23:59:59.000Z',isDeleted:0});
 const olderDate=localDay(new Date(2026,8,30-60));
 h.insert('transactions',{id:'kh_older',userId:'owner',partyName:'Backdated',amount_paisa:7,type:'dena',date:olderDate,createdAt:olderDate+'T00:00:01.000Z',isDeleted:0});
 assert.ok(after(keyOf(loaded.at(-1)),[olderDate,olderDate+'T00:00:01.000Z','kh_older']));
 const rest=await pageKhata(h,'owner',{},50,cur);const restIds=rest.flatMap(p=>p.transactions.map(e=>e.id));
 const seq=[...loaded,...rest.flatMap(p=>p.transactions)];
 assert.ok(!restIds.includes('kh_newest'));assert.equal(restIds.filter(x=>x==='kh_older').length,1);
 assert.equal(new Set(seq.map(e=>e.id)).size,seq.length);for(let i=1;i<seq.length;i++)assert.ok(after(keyOf(seq[i-1]),keyOf(seq[i])));
 assert.deepEqual(seq.map(e=>e.id).filter(id=>id!=='kh_older'),allBefore);
 for(const pg of rest){assert.equal(pg.balanceSummary.totalLena,before[0].balanceSummary.totalLena+5);assert.equal(pg.balanceSummary.totalDena,before[0].balanceSummary.totalDena+7);}
 const reload=await pageKhata(h,'owner',{});const reIds=reload.flatMap(p=>p.transactions.map(e=>e.id));
 assert.equal(reIds[0],'kh_newest');assert.ok(reIds.includes('kh_older'));assert.equal(reIds.length,allBefore.length+2);
 // Delete mid-scroll.
 const two2=[];cur=null;for(let i=0;i<2;i++){const pg=await khata(h).getFilteredKhata('owner',{},50,0,cur);two2.push(pg);cur=pg.nextCursor;}
 const expectedRest=(await pageKhata(h,'owner',{},50,cur)).flatMap(p=>p.transactions.map(e=>e.id));
 h.sqlite.prepare('UPDATE transactions SET isDeleted=1 WHERE id=?').run(two2[0].transactions[3].id);
 assert.deepEqual((await pageKhata(h,'owner',{},50,cur)).flatMap(p=>p.transactions.map(e=>e.id)),expectedRest);
 // Customer Ledger: per-party balances are ALL-TIME and identical whatever Khata's range is.
 const ledger=(await khata(h).getPartyBalances('owner',{})).rows;
 const live=rows.filter(r=>r.userId==='owner'&&!r.isDeleted&&r.id!==two2[0].transactions[3].id);
 for(const party of ['Ali Traders','Bilal Store','Chand Foods','Danish Mart']){
  const mine=live.filter(r=>r.partyName===party);const l=mine.filter(r=>r.type==='lena').reduce((a,r)=>a+r.amount_paisa,0),d=mine.filter(r=>r.type==='dena').reduce((a,r)=>a+r.amount_paisa,0);
  const row=ledger.find(x=>x.partyName===party);assert.ok(row,party);assert.equal(row.totalLena,l,party+' lena all-time');assert.equal(row.totalDena,d,party+' dena all-time');assert.equal(row.netBalance,l-d);
 }
 const monthOnly=await khata(h).getFilteredKhata('owner',{startDate:'2026-09-01',endDate:'2026-09-30'});
 const ledgerSum=ledger.reduce((a,r)=>a+r.totalLena,0);assert.ok(ledgerSum>monthOnly.balanceSummary.totalLena,'ledger covers more than one month');
 assert.ok(!/startDate|endDate|BETWEEN/.test(read('src/services/database/transactionDb.ts').split('export const getPartyBalances')[1].split('export const')[0]),'getPartyBalances takes no range');
 // Source guards.
 const db=read('src/services/database/transactionDb.ts');const sect=db.slice(db.indexOf('export const getFilteredKhata'),db.indexOf('export type { Transaction }'));
 assert.equal((sect.match(/FROM transactions WHERE \$\{where\}/g)||[]).length,2,'summary and day-totals use the un-cursored WHERE');
 assert.equal((sect.match(/rowsWhere/g)||[]).length,2,'only the rows query is cursored');assert.ok(/GROUP BY date\(date\)/.test(sect));
 const screen=read('src/screens/staff/KhataScreen.tsx');
 assert.ok(/<SectionList[\s\S]*stickySectionHeadersEnabled[\s\S]*onEndReached=\{loadMore\}/.test(screen));assert.ok(!/<FlatList/.test(screen));
 assert.ok(/useState<DateRange>\(\(\) => thisMonthRange\(\)\)/.test(screen),'opens on this month');
 assert.ok(/getKhataDayTotals\(user\.id, activeFilter\)/.test(screen)&&/getFilteredKhata\(user\.id, activeFilter, PAGE_SIZE, 0, cursor\)/.test(screen));
 assert.ok(!/\.reduce\(/.test(screen),'no on-screen summing');
 assert.ok(/<CustomerBalanceList/.test(screen),'Khata must render the customer list itself, not link to it');
 assert.ok(/useState<'customers' | 'activity'>('customers')/.test(screen),'Khata must OPEN on the customer list');
 assert.ok(/khataTabCustomers/.test(screen)&&/khataTabActivity/.test(screen),'the activity view must still be reachable');
 // Both captions are translated now, so the keys are pinned, not the English words.
 assert.ok(/khataTotalsFor', \{ range: describeRange\(range\) \}/.test(screen),'Activity must say which range its figures cover');
 assert.ok(!/khataAllTimePerCustomer/.test(screen),'the link to a separate customer list should be gone — the list is the default view');
 assert.ok(/const \{ transactions: all, balanceSummary: totals \} = await getFilteredKhata\(user\.id, activeFilter\);/.test(screen),'PDF export covers the whole range, not the loaded page');
 assert.ok(/generateTransactionPDF\(all, [^\n]*, totals\)/.test(screen),'PDF totals are the SQL summary, not re-added in JS');
 for(const nav of ['src/navigation/AdminNavigator.tsx']){const n=read(nav);const i=n.indexOf('name="KhataMain"');const stack=n.slice(n.lastIndexOf('<Stack.Navigator',i),n.indexOf('</Stack.Navigator>',i));
  assert.ok(stack.includes('name="CustomerDetail"'),nav+': the Khata stack must still open a customer');
  assert.ok(!n.includes('CustomerLedger'),nav+': CustomerLedgerScreen was deleted — a registered route with no screen crashes on navigate');}
}));

// ── List scaling, batch A: Bill Book, Expense Book, Stock reports + item detail ──
// Every book is OWN-ONLY: a viewer's book holds exactly the rows they created. Other
// people's rows are reachable only through the Staff Book drill-down (tested separately).
const TREE={owner:['owner'],staffA:['staffA'],subA:['subA']};
async function pageWith(fn,limit=50,startCursor=null){
 const pages=[];let cursor=startCursor;let guard=0;
 do{const page=await fn(limit,cursor);pages.push(page);cursor=page.nextCursor;assert.ok(++guard<500,'runaway paging');}while(cursor);
 return pages;
}
// Generic keyset contract: totals byte-identical on every page and vs uncapped; every row
// once, strictly descending, sequence == uncapped, full non-final pages; scope + deletion.
function assertPaging(label,pages,uncapped,rowsOf,summaryOf,expectedIds,keyFn,failures){
 const t0=JSON.stringify(plain(summaryOf(pages[0])));
 for(const pg of pages)if(JSON.stringify(plain(summaryOf(pg)))!==t0)failures.push(label+': summary changed between pages');
 if(t0!==JSON.stringify(plain(summaryOf(uncapped))))failures.push(label+': paged summary differs from uncapped');
 const seen=pages.flatMap(rowsOf);const ids=seen.map(r=>r.id);
 if(new Set(ids).size!==ids.length)failures.push(label+': duplicates');
 if(ids.length!==expectedIds.size)failures.push(label+': paged '+ids.length+' vs expected '+expectedIds.size);
 for(const id of ids)if(!expectedIds.has(id))failures.push(label+': unexpected row '+id);
 for(let i=1;i<seen.length;i++)if(!after(keyFn(seen[i-1]),keyFn(seen[i])))failures.push(label+': order broke at '+seen[i].id);
 if(JSON.stringify(ids)!==JSON.stringify(rowsOf(uncapped).map(r=>r.id)))failures.push(label+': paged sequence differs from uncapped');
 for(const pg of pages.slice(0,-1))if(rowsOf(pg).length!==50)failures.push(label+': short non-final page');
 return t0;
}
function seedBigBills(h){
 seedPeople(h);const rows=[];let n=0;
 for(const who of ['owner','staffA','subA','staffB','subB','otherStaff'])for(let d=0;d<120;d++){
  const date=localDay(new Date(2026,8,30-d,12));const perDay=who==='owner'?9:who==='otherStaff'?3:6;
  for(let k=0;k<perDay;k++){
   n++;const created_at=date+'T'+String(8+(k%6)).padStart(2,'0')+':00:00.000Z';
   const row={id:'bl_'+String(n).padStart(5,'0'),user_id:who,party_name:'Party '+(n%7),bill_no:n,total:100000+n,paid:n%4===0?100000+n:50000,due:n%4===0?0:50000+n,bill_date:date,created_at,is_deleted:n%17===0?1:0,is_draft:n%23===0?1:0,is_hold:n%29===0?1:0};
   h.insert('bills',row);rows.push(row);
   h.insert('bill_items',{id:'bi_'+n+'_a',bill_id:row.id,item_name:'A'+n,quantity:1,unit_price:1,line_total:1,is_deleted:0});
   h.insert('bill_items',{id:'bi_'+n+'_b',bill_id:row.id,item_name:'B'+n,quantity:2,unit_price:1,line_total:2,is_deleted:0});
   h.insert('bill_items',{id:'bi_'+n+'_x',bill_id:row.id,item_name:'X'+n,quantity:9,unit_price:1,line_total:9,is_deleted:1});
  }
 }
 return rows;
}
check(87,'Bill Book: keyset paging with the bill_items N+1 folded into one query per page; totals byte-identical; day subtotals SQL; insert/delete mid-scroll',at('src/services/database/billDb.ts','getBillDayTotals'),()=>isolated(async h=>{
 const rows=seedBigBills(h);assert.ok(rows.length>4000);const api=billDb(h);
 const posted=r=>!r.is_draft&&!r.is_hold;
 const filters=[{status:'posted'},{status:'posted',startDate:'2026-09-01',endDate:'2026-09-30'},{status:'all'},{status:'drafts'},{status:'posted',search:'party 3'}];
 const failures=[];
 for(const [viewer,scope] of Object.entries(TREE))for(const filter of filters){
  const inRange=r=>(!filter.startDate||r.bill_date>=filter.startDate)&&(!filter.endDate||r.bill_date<=filter.endDate);
  const okStatus=r=>filter.status==='all'||(filter.status==='drafts'?r.is_draft===1:filter.status==='holds'?r.is_hold===1:posted(r));
  const expected=rows.filter(r=>scope.includes(r.user_id)&&!r.is_deleted&&inRange(r)&&okStatus(r)&&(!filter.search||r.party_name.toLowerCase().includes(filter.search)));
  const expectedIds=new Set(expected.map(r=>r.id));
  const uncapped=await api.getFilteredBills(viewer,filter);assert.equal(uncapped.nextCursor,null);
  const pages=await pageWith((limit,cursor)=>api.getFilteredBills(viewer,filter,limit,0,cursor));
  const label=viewer+' '+JSON.stringify(filter)+' ('+expected.length+' rows, '+pages.length+' pages)';
  const t0=assertPaging(label,pages,uncapped,pg=>pg.bills,pg=>pg.billSummary,expectedIds,r=>[r.bill_date,r.created_at||'',r.id],failures);
  const pkr=(pick)=>[{currency:'PKR',amount:expected.reduce((a,r)=>a+pick(r),0)}];
  const fix={billCount:expected.length,totalBilled:pkr(r=>r.total),totalPaid:pkr(r=>r.paid),totalDue:pkr(r=>r.due)};
  if(t0!==JSON.stringify(fix))failures.push(label+': summary '+t0+' vs fixture '+JSON.stringify(fix));
  // Items ride along on every page, live ones only, in ONE query per page.
  for(const pg of pages)for(const b of pg.bills){if(!Array.isArray(b.items)||b.items.length!==2||b.items.some(i=>i.bill_id!==b.id||i.is_deleted))failures.push(label+': items wrong on '+b.id);}
  const days=await api.getBillDayTotals(viewer,filter);
  const byDay={};for(const r of expected){const d=byDay[r.bill_date]||(byDay[r.bill_date]={billCount:0,totalBilled:0,totalPaid:0,totalDue:0});d.billCount++;d.totalBilled+=r.total;d.totalPaid+=r.paid;d.totalDue+=r.due;}
  if(days.length!==Object.keys(byDay).length)failures.push(label+': day rows');
  for(const k of Object.keys(byDay)){const e=byDay[k];for(const f of ['totalBilled','totalPaid','totalDue'])e[f]=[{currency:'PKR',amount:e[f]}];}
  for(const d of days){const e=byDay[d.day];if(!e||JSON.stringify(plain({billCount:d.billCount,totalBilled:d.totalBilled,totalPaid:d.totalPaid,totalDue:d.totalDue}))!==JSON.stringify(e))failures.push(label+': day '+d.day);}
 }
 assert.equal(failures.length,0,failures.join('\n'));
 // N+1 folded: a 50-bill page issues exactly one bill_items query.
 const before=h.queries.length;const pg=await api.getFilteredBills('owner',{status:'posted'},50);assert.equal(pg.bills.length,50);
 const itemQueries=h.queries.slice(before).filter(q=>/FROM bill_items/.test(q));
 assert.equal(itemQueries.length,1,'one bill_items query per page, got '+itemQueries.length);assert.ok(/IN \(\?/.test(itemQueries[0]));
 // Straddle, insert and delete mid-scroll.
 const f={status:'posted'};const first=await pageWith((l,c)=>api.getFilteredBills('owner',f,l,0,c));const cut=first[0].bills.at(-1).bill_date;
 assert.ok(first[1].bills.some(b=>b.bill_date===cut));
 assert.equal((await api.getBillDayTotals('owner',f)).find(d=>d.day===cut).billCount,first[0].bills.filter(b=>b.bill_date===cut).length+first[1].bills.filter(b=>b.bill_date===cut).length);
 const allBefore=first.flatMap(p=>p.bills.map(b=>b.id));
 const two=[];let cur=null;for(let i=0;i<2;i++){const x=await api.getFilteredBills('owner',f,50,0,cur);two.push(x);cur=x.nextCursor;}
 h.insert('bills',{id:'bl_newest',user_id:'owner',party_name:'Late',bill_no:99999,total:5,paid:5,due:0,bill_date:'2026-09-30',created_at:'2026-09-30T23:59:59.000Z',is_deleted:0,is_draft:0,is_hold:0});
 const olderDate=localDay(new Date(2026,8,30-60));
 h.insert('bills',{id:'bl_older',user_id:'owner',party_name:'Backdated',bill_no:99998,total:7,paid:0,due:7,bill_date:olderDate,created_at:olderDate+'T00:00:01.000Z',is_deleted:0,is_draft:0,is_hold:0});
 const rest=await pageWith((l,c)=>api.getFilteredBills('owner',f,l,0,c),50,cur);const restIds=rest.flatMap(p=>p.bills.map(b=>b.id));
 const seq=[...two.flatMap(p=>p.bills),...rest.flatMap(p=>p.bills)];
 assert.ok(!restIds.includes('bl_newest'));assert.equal(restIds.filter(x=>x==='bl_older').length,1);assert.equal(new Set(seq.map(b=>b.id)).size,seq.length);
 assert.deepEqual(seq.map(b=>b.id).filter(id=>id!=='bl_older'),allBefore);
 for(const x of rest)assert.equal(only(x.billSummary.totalBilled),only(first[0].billSummary.totalBilled)+12,'continued pages already carry both inserts in the summary');
 const two2=[];cur=null;for(let i=0;i<2;i++){const x=await api.getFilteredBills('owner',f,50,0,cur);two2.push(x);cur=x.nextCursor;}
 const expectedRest=(await pageWith((l,c)=>api.getFilteredBills('owner',f,l,0,c),50,cur)).flatMap(p=>p.bills.map(b=>b.id));
 h.sqlite.prepare('UPDATE bills SET is_deleted=1 WHERE id=?').run(two2[0].bills[3].id);
 assert.deepEqual((await pageWith((l,c)=>api.getFilteredBills('owner',f,l,0,c),50,cur)).flatMap(p=>p.bills.map(b=>b.id)),expectedRest);
 // Source: cursor on rows only; store pages; screen groups; default still this month.
 const db=read('src/services/database/billDb.ts');const sect=db.slice(db.indexOf('export const getFilteredBills'),db.indexOf('export const billMatchesFilter'));
 assert.equal((sect.match(/rowsWhere/g)||[]).length,2); assert.ok(/FROM bills WHERE \$\{where}/.test(sect),'the aggregates no longer use the shared predicate'); assert.ok(/GROUP BY date\(bill_date\), currency/.test(sect),'day subtotals must group by currency, never sum across them'); assert.ok(/GROUP BY currency/.test(sect),'the headline total must group by currency, never sum across them');
 assert.ok(!/for \(const b of bills\) \{[\s\S]*bill_items WHERE bill_id = \?/.test(db),'per-bill item query is gone');
 const store=read('src/store/useBillStore.ts');assert.ok(/getFilteredBills\(userId, query, PAGE_SIZE\)/.test(store)&&/getFilteredBills\(userId, query, PAGE_SIZE, 0, cursor\)/.test(store)&&/getBillDayTotals\(userId, query\)/.test(store));
 assert.ok(/filter: \{ status: 'posted', \.\.\.thisMonth\(\) \}/.test(store),'default stays this month');
 const screen=read('src/screens/BillBook/BillBookScreen.tsx');assert.ok(/<SectionList[\s\S]*stickySectionHeadersEnabled[\s\S]*onEndReached=\{loadMore\}/.test(screen)&&!/<FlatList/.test(screen)&&!/\.reduce\(/.test(screen));
 assert.ok(/t\('billBilled'\)\}<\/Text>[\s\S]*t\('billPaid'\)\}<\/Text>/.test(screen),'day header shows Billed and Paid');
}));
function seedBigExpenses(h){
 seedPeople(h);const rows=[];let n=0;const cats=['Rent','Fuel','Tea','Salary'];
 for(const who of ['owner','staffA','subA','staffB','subB','otherStaff'])for(let d=0;d<120;d++){
  const date=localDay(new Date(2026,8,30-d,12));const perDay=who==='owner'?9:who==='otherStaff'?3:6;
  for(let k=0;k<perDay;k++){n++;const created_at=date+'T'+String(8+(k%6)).padStart(2,'0')+':00:00.000Z';
   const row={id:'ex_'+String(n).padStart(5,'0'),user_id:who,description:'E'+n+(k===1?' needle':''),category:cats[k%4],amount:1000+n,expense_date:date,created_at,is_deleted:n%17===0?1:0};
   h.insert('expenses',row);rows.push(row);}
 }
 return rows;
}
check(88,'Expense Book: keyset paging, totals byte-identical at 1 vs N pages, day subtotals SQL, default this month, insert/delete mid-scroll',at('src/services/database/expenseDb.ts','getExpenseDayTotals'),()=>isolated(async h=>{
 const rows=seedBigExpenses(h);assert.ok(rows.length>4000);const api=h.load('src/services/database/expenseDb.ts');
 const filters=[{},{startDate:'2026-09-01',endDate:'2026-09-30'},{category:'Fuel'},{search:'needle',startDate:'2026-08-01',endDate:'2026-08-31'}];
 const failures=[];
 for(const [viewer,scope] of Object.entries(TREE))for(const filter of filters){
  const inRange=r=>(!filter.startDate||r.expense_date>=filter.startDate)&&(!filter.endDate||r.expense_date<=filter.endDate);
  const expected=rows.filter(r=>scope.includes(r.user_id)&&!r.is_deleted&&inRange(r)&&(!filter.category||r.category===filter.category)&&(!filter.search||(r.description+' '+r.category).toLowerCase().includes(filter.search)));
  const expectedIds=new Set(expected.map(r=>r.id));
  const uncapped=await api.getFilteredExpenses(viewer,filter);assert.equal(uncapped.nextCursor,null);
  const pages=await pageWith((l,c)=>api.getFilteredExpenses(viewer,filter,l,0,c));
  const label=viewer+' '+JSON.stringify(filter)+' ('+expected.length+' rows, '+pages.length+' pages)';
  const t0=assertPaging(label,pages,uncapped,pg=>pg.expenses,pg=>pg.expenseSummary,expectedIds,r=>[r.expense_date,r.created_at||'',r.id],failures);
  if(t0!==JSON.stringify({totalExpense:[{currency:'PKR',amount:expected.reduce((a,r)=>a+r.amount,0)}]}))failures.push(label+': summary vs fixture');
  const days=await api.getExpenseDayTotals(viewer,filter);
  const byDay={};for(const r of expected){const d=byDay[r.expense_date]||(byDay[r.expense_date]={totalExpense:0,entryCount:0});d.totalExpense+=r.amount;d.entryCount++;}
  for(const k of Object.keys(byDay))byDay[k].totalExpense=[{currency:'PKR',amount:byDay[k].totalExpense}];
  if(days.length!==Object.keys(byDay).length)failures.push(label+': day rows');
  for(const d of days){const e=byDay[d.day];if(!e||JSON.stringify(plain(e.totalExpense))!==JSON.stringify(plain(d.totalExpense))||e.entryCount!==d.entryCount)failures.push(label+': day '+d.day);}
 }
 assert.equal(failures.length,0,failures.join('\n'));
 const f={};const first=await pageWith((l,c)=>api.getFilteredExpenses('owner',f,l,0,c));const cut=first[0].expenses.at(-1).expense_date;
 assert.ok(first[1].expenses.some(e=>e.expense_date===cut));
 assert.equal((await api.getExpenseDayTotals('owner',f)).find(d=>d.day===cut).entryCount,first[0].expenses.filter(e=>e.expense_date===cut).length+first[1].expenses.filter(e=>e.expense_date===cut).length);
 const allBefore=first.flatMap(p=>p.expenses.map(e=>e.id));
 let cur=null;const two=[];for(let i=0;i<2;i++){const x=await api.getFilteredExpenses('owner',f,50,0,cur);two.push(x);cur=x.nextCursor;}
 h.insert('expenses',{id:'ex_newest',user_id:'owner',description:'late',amount:5,expense_date:'2026-09-30',created_at:'2026-09-30T23:59:59.000Z',is_deleted:0});
 const olderDate=localDay(new Date(2026,8,30-60));
 h.insert('expenses',{id:'ex_older',user_id:'owner',description:'backdated',amount:7,expense_date:olderDate,created_at:olderDate+'T00:00:01.000Z',is_deleted:0});
 const rest=await pageWith((l,c)=>api.getFilteredExpenses('owner',f,l,0,c),50,cur);const restIds=rest.flatMap(p=>p.expenses.map(e=>e.id));
 const seq=[...two.flatMap(p=>p.expenses),...rest.flatMap(p=>p.expenses)];
 assert.ok(!restIds.includes('ex_newest'));assert.equal(restIds.filter(x=>x==='ex_older').length,1);assert.equal(new Set(seq.map(e=>e.id)).size,seq.length);
 assert.deepEqual(seq.map(e=>e.id).filter(id=>id!=='ex_older'),allBefore);
 for(const x of rest)assert.equal(only(x.expenseSummary.totalExpense),only(first[0].expenseSummary.totalExpense)+12);
 const two2=[];cur=null;for(let i=0;i<2;i++){const x=await api.getFilteredExpenses('owner',f,50,0,cur);two2.push(x);cur=x.nextCursor;}
 const expectedRest=(await pageWith((l,c)=>api.getFilteredExpenses('owner',f,l,0,c),50,cur)).flatMap(p=>p.expenses.map(e=>e.id));
 h.sqlite.prepare('UPDATE expenses SET is_deleted=1 WHERE id=?').run(two2[0].expenses[3].id);
 assert.deepEqual((await pageWith((l,c)=>api.getFilteredExpenses('owner',f,l,0,c),50,cur)).flatMap(p=>p.expenses.map(e=>e.id)),expectedRest);
 const db=read('src/services/database/expenseDb.ts');const sect=db.slice(db.indexOf('export const getFilteredExpenses'),db.indexOf('export const addExpenseRecord'));
 assert.equal((sect.match(/rowsWhere/g)||[]).length,2);assert.ok(/GROUP BY date\(expense_date\)/.test(sect));
 const store=read('src/store/useExpenseStore.ts');assert.ok(/filter: \{ \.\.\.thisMonthRange\(\) \}/.test(store),'opens on this month');
 assert.ok(/getFilteredExpenses\(userId, query, PAGE_SIZE\)/.test(store)&&/getFilteredExpenses\(userId, query, PAGE_SIZE, 0, cursor\)/.test(store)&&/getExpenseDayTotals\(userId, query\)/.test(store));
 const screen=read('src/screens/ExpenseBook/ExpenseBookScreen.tsx');assert.ok(/<SectionList[\s\S]*stickySectionHeadersEnabled[\s\S]*onEndReached=\{loadMore\}/.test(screen)&&!/<FlatList/.test(screen)&&!/\.reduce\(/.test(screen));
 assert.ok(/<DateRangeFilter value=\{range\}/.test(screen),'range control stays visible');
}));
function seedBigMovements(h){
 seedPeople(h);const rows=[];let n=0;
 for(const who of ['owner','staffA','subA','staffB','subB','otherStaff']){
  for(let i=0;i<3;i++)h.insert('stock_items',{id:'it_'+who+'_'+i,user_id:who,name_en:'ROW_'+who+'_item'+i,name_ur:'اردو'+i,purchase_price:1,sale_price:1,quantity:9});
  for(let d=0;d<120;d++){const date=localDay(new Date(2026,8,30-d,12));const perDay=who==='owner'?9:who==='otherStaff'?3:6;
   for(let k=0;k<perDay;k++){n++;const row={id:'mv_'+String(n).padStart(5,'0'),user_id:who,item_id:'it_'+who+'_'+(k%3),change:k%2?2+k:-(1+k),cost_per_unit:100+n,sale_price_unit:k%5?200+n:null,date,is_deleted:n%17===0?1:0};h.insert('stock_movements',row);rows.push(row);}}
 }
 return rows;
}
check(89,'Stock IN/OUT reports page with SQL header totals and day subtotals; item detail filters the month in SQL and pages',at('src/services/database/stockDb.ts','getStockMovementDayTotals'),()=>isolated(async h=>{
 const rows=seedBigMovements(h);assert.ok(rows.length>4000);const api=h.load('src/services/database/stockDb.ts');
 const rateOf=(r,dir)=>dir==='in'?(r.cost_per_unit||0):(r.sale_price_unit||r.cost_per_unit||0);
 const filters=[{},{startDate:'2026-09-01',endDate:'2026-09-30'},{search:'item1'},{startDate:'2026-08-01',search:'ROW_staffA'}];
 const failures=[];
 for(const [viewer,scope] of Object.entries(TREE))for(const dir of ['in','out'])for(const filter of filters){
  const inRange=r=>(!filter.startDate||r.date>=filter.startDate)&&(!filter.endDate||r.date<=filter.endDate);
  const expected=rows.filter(r=>scope.includes(r.user_id)&&!r.is_deleted&&inRange(r)&&(dir==='in'?r.change>0:r.change<0)&&(!filter.search||('ROW_'+r.user_id+'_item'+r.item_id.slice(-1)).toLowerCase().includes(filter.search.toLowerCase())));
  const expectedIds=new Set(expected.map(r=>r.id));
  const call=(l,c)=>api.getStockMovementReport(viewer,dir,filter.startDate,filter.endDate,l,c,filter.search);
  const uncapped=await call(-1,null);assert.equal(uncapped.nextCursor,null);
  const pages=await pageWith(call);
  const label=viewer+'/'+dir+' '+JSON.stringify(filter)+' ('+expected.length+' rows, '+pages.length+' pages)';
  const t0=assertPaging(label,pages,uncapped,pg=>pg.rows,pg=>pg.summary,expectedIds,r=>[r.date,'',r.id],failures);
  const fix={entries:expected.length,qty:expected.reduce((a,r)=>a+Math.abs(r.change),0),amount:expected.reduce((a,r)=>a+Math.abs(r.change)*rateOf(r,dir),0)};
  if(t0!==JSON.stringify(fix))failures.push(label+': summary '+t0+' vs '+JSON.stringify(fix));
  const days=await api.getStockMovementDayTotals(viewer,dir,filter.startDate,filter.endDate,filter.search);
  const byDay={};for(const r of expected){const d=byDay[r.date]||(byDay[r.date]={entries:0,qty:0,amount:0});d.entries++;d.qty+=Math.abs(r.change);d.amount+=Math.abs(r.change)*rateOf(r,dir);}
  if(days.length!==Object.keys(byDay).length)failures.push(label+': day rows');
  for(const d of days){const e=byDay[d.day];if(!e||e.entries!==d.entries||e.qty!==d.qty||e.amount!==d.amount)failures.push(label+': day '+d.day);}
 }
 assert.equal(failures.length,0,failures.join('\n'));
 // Insert/delete mid-scroll on the IN report (keyset on date, id — no created_at).
 const call=(l,c)=>api.getStockMovementReport('owner','in',undefined,undefined,l,c);
 const first=await pageWith(call);const allBefore=first.flatMap(p=>p.rows.map(r=>r.id));
 let cur=null;const two=[];for(let i=0;i<2;i++){const x=await call(50,cur);two.push(x);cur=x.nextCursor;}
 h.insert('stock_movements',{id:'mv_newest',user_id:'owner',item_id:'it_owner_0',change:3,cost_per_unit:5,date:'2026-09-30',is_deleted:0});
 const olderDate=localDay(new Date(2026,8,30-60));
 h.insert('stock_movements',{id:'mv_older',user_id:'owner',item_id:'it_owner_0',change:4,cost_per_unit:7,date:olderDate,is_deleted:0});
 const rest=await pageWith(call,50,cur);const restIds=rest.flatMap(p=>p.rows.map(r=>r.id));
 const seq=[...two.flatMap(p=>p.rows),...rest.flatMap(p=>p.rows)];
 assert.ok(!restIds.includes('mv_newest'));assert.equal(restIds.filter(x=>x==='mv_older').length,1);assert.equal(new Set(seq.map(r=>r.id)).size,seq.length);
 assert.deepEqual(seq.map(r=>r.id).filter(id=>id!=='mv_older'),allBefore);
 for(const x of rest)assert.equal(x.summary.amount,first[0].summary.amount+3*5+4*7);
 const two2=[];cur=null;for(let i=0;i<2;i++){const x=await call(50,cur);two2.push(x);cur=x.nextCursor;}
 const expectedRest=(await pageWith(call,50,cur)).flatMap(p=>p.rows.map(r=>r.id));
 h.sqlite.prepare('UPDATE stock_movements SET is_deleted=1 WHERE id=?').run(two2[0].rows[3].id);
 assert.deepEqual((await pageWith(call,50,cur)).flatMap(p=>p.rows.map(r=>r.id)),expectedRest);
 // Item detail: month filtered in SQL, stats a SQL aggregate, paged, months from SQL.
 // (the two mid-scroll inserts above landed on this item — the owner's own — so they count too)
 const item='it_owner_0';const mine=[...rows,...h.all("SELECT * FROM stock_movements WHERE id IN ('mv_newest','mv_older')")].filter(r=>r.item_id===item&&!r.is_deleted&&r.id!==two2[0].rows[3].id);
 const months=await api.getItemMovementMonths(item);assert.deepEqual(plain(months),sorted(new Set(mine.map(r=>r.date.slice(0,7)))));
 for(const month of [...months,'ALL']){
  const exp=mine.filter(r=>month==='ALL'||r.date.startsWith(month));
  const pages=await pageWith((l,c)=>api.getItemMovements(item,month,l,c));const ids=pages.flatMap(p=>p.rows.map(r=>r.id));
  assert.deepEqual(sorted(ids),sorted(exp.map(r=>r.id)),month+' rows');assert.equal(new Set(ids).size,ids.length);
  const st=pages[0].summary;assert.deepEqual(plain(st),{totalIn:exp.filter(r=>r.change>0).reduce((a,r)=>a+r.change,0),totalOut:exp.filter(r=>r.change<0).reduce((a,r)=>a-r.change,0),count:exp.length},month+' stats');
  for(const pg of pages)assert.deepEqual(plain(pg.summary),plain(st));
  for(const pg of pages)for(const r of pg.rows)assert.ok(month==='ALL'||r.date.startsWith(month),'row outside the month');
 }
 await assert.rejects(()=>api.getItemMovements(item,'2026-9'),/Invalid month/);
 // Source: screens/store wired to the paged, SQL-summarised path; no JS month filter or reduce.
 // Both reports open a LIST OF ITEMS; tapping one opens that item alone.
 for(const [f,dir] of [['src/screens/StockBook/StockInReportScreen.tsx','in'],['src/screens/StockBook/StockOutReportScreen.tsx','out']]){
  const src=read(f);
  assert.ok(/<FlatList[\s\S]*onEndReached=\{loadMore\}/.test(src)&&!/<SectionList/.test(src),f+' lists items, paged');
  assert.ok(!/\.reduce\(/.test(src)&&!/\.filter\(item =>/.test(src),f+' no in-memory search/sum');
  assert.ok(src.includes("fetchMovementItems(user.id, '"+dir+"', { startDate: startStr, endDate: endStr, search: searchQuery })"),f+' search in SQL');
  assert.ok(/\{summary\.entries\}/.test(src)&&/const totalQty = summary\.qty;/.test(src),f+' header totals from SQL');
  assert.ok(/navigation\.navigate\('StockMovementItem', \{/.test(src)&&src.includes("direction: '"+dir+"', itemId: item.item_id"),f+' opens one item');
 }
 {
  const item=read('src/screens/StockBook/StockMovementItemScreen.tsx');
  assert.ok(/getStockMovementReport\(\s*\n?\s*user\.id, direction, period\?\.startDate, period\?\.endDate, PAGE_SIZE, null, undefined, itemId/.test(item),'the item view calls the report query, filtered to the item');
  assert.ok(/onEndReached=\{loadMore\}/.test(item)&&/summary\.qty/.test(item)&&/paisa=\{summary\.amount\}/.test(item),'item view: paged rows, SQL totals');
  assert.ok(!/formatCurrency\((summary\.qty|qty)\)/.test(item),'a quantity is never money');
  for(const nav of ['src/navigation/AdminNavigator.tsx'])assert.ok(/name="StockMovementItem"/.test(read(nav)),nav+' registers the item view');
 }
 const det=read('src/screens/StockBook/StockItemDetailScreen.tsx');
 assert.ok(!/getMovementsByItemId/.test(det)&&/getItemMovements\(item\.id, selectedMonth, PAGE_SIZE\)/.test(det)&&/getItemMovements\(item\.id, selectedMonth, PAGE_SIZE, cursor\)/.test(det));
 assert.ok(!/movements\.filter\(m => m\.date && m\.date\.startsWith\(selectedMonth\)\)/.test(det),'JS month filter gone');assert.ok(!/filteredMovements\.forEach/.test(det),'JS stats gone');
 assert.ok(/\[item\.id, selectedMonth\]\)/.test(det),'reloads on month change');assert.ok(/onEndReached=\{loadMore\}/.test(det));
 const store=read('src/store/useStockStore.ts');assert.ok(/getStockMovementReport\(userId, direction, filter\.startDate, filter\.endDate, PAGE_SIZE, null, filter\.search\)/.test(store)&&/getStockMovementDayTotals\(userId, direction, filter\.startDate, filter\.endDate, filter\.search\)/.test(store));
 const db=read('src/services/database/stockDb.ts');assert.ok(/GROUP BY date\(m\.date\)/.test(db)&&/strftime\('%Y-%m', date\) = \?/.test(db));
}));

// ── List scaling, batch B: Activity Log, Purchase Book, Customer Book + pickers ──
check(90,'Activity Log: visibility OR is parenthesised, deleted rows excluded, a lone date bound works, keyset on (timestamp,id) reaches everything past the old LIMIT 100',at('src/services/database/activityDb.ts','ACTIVITY_KEYS'),()=>isolated(async h=>{
 seedPeople(h);const api=h.load('src/services/database/activityDb.ts');const rows=[];let n=0;
 // 6,000 activities over 150 days: written by staffA/subA (visible to owner via visible_to),
 // by the owner, and by the other business (never visible); some deleted; shared timestamps.
 for(let d=0;d<150;d++)for(let k=0;k<40;k++){n++;
  const who=k%4===0?'owner':k%4===1?'staffA':k%4===2?'subA':'otherStaff';
  const ts=new Date(Date.UTC(2026,8,30-d,8+(k%6),0,0)).toISOString();
  const row={id:'act_'+String(n).padStart(5,'0'),user_id:who,user_name:who,action:k%3?'create':'delete',entity_type:k%5?'cash':'bill',description:'x'+n,visible_to:JSON.stringify(who==='owner'?['owner']:who==='otherStaff'?['otherOwner']:['staffA','owner']),timestamp:ts,is_deleted:n%19===0?1:0};
  h.insert('activities',row);rows.push(row);}
 const vis=rows.filter(r=>!r.is_deleted&&(r.user_id==='owner'||JSON.parse(r.visible_to).includes('owner')));
 assert.ok(vis.length>3000);
 // The precedence bug: with the old \`A OR B AND C\`, an entityType filter leaked every
 // visible_to row regardless of entity. Now the filter narrows the whole visible set.
 const bills=(await api.getActivities('owner',{entityType:'bill'},-1)).rows;
 assert.equal(bills.length,vis.filter(r=>r.entity_type==='bill').length);assert.ok(bills.every(r=>r.entity_type==='bill'),'entity filter leaked');
 const staffOnly=(await api.getActivities('owner',{staffId:'subA'},-1)).rows;
 assert.ok(staffOnly.length>0&&staffOnly.every(r=>r.user_id==='subA'),'staff filter leaked');
 assert.ok(!(await api.getActivities('owner',{},-1)).rows.some(r=>r.is_deleted||r.user_id==='otherStaff'),'deleted or foreign rows visible');
 assert.ok(!(await api.getActivities('staffA',{},-1)).rows.some(r=>r.user_id==='owner'&&!JSON.parse(r.visible_to).includes('staffA')),'staff sees owner-only rows');
 // A lone startDate (the dashboard's "last 7 days") now filters; it used to be ignored.
 const since=(await api.getActivities('owner',{startDate:'2026-09-24'},-1)).rows;
 assert.equal(since.length,vis.filter(r=>r.timestamp.slice(0,10)>='2026-09-24').length);assert.ok(since.every(r=>r.timestamp.slice(0,10)>='2026-09-24'));
 const upto=(await api.getActivities('owner',{endDate:'2026-06-01'},-1)).rows;assert.ok(upto.length>0&&upto.every(r=>r.timestamp.slice(0,10)<='2026-06-01'));
 assert.equal((await api.getActivities('owner',{startDate:'2026-09-24'},5)).rows.length,5,'dashboard asks for five');
 await assert.rejects(()=>api.getActivities('owner',{startDate:'nope'}),/Invalid date/);
 // Paging: every visible row exactly once, strictly descending, well past 100.
 const pages=await pageWith((l,c)=>api.getActivities('owner',{},l,c));const ids=pages.flatMap(pg=>pg.rows.map(r=>r.id));
 assert.equal(ids.length,vis.length,'old LIMIT 100 gone: '+ids.length);assert.equal(new Set(ids).size,ids.length);
 const seen=pages.flatMap(pg=>pg.rows);for(let i=1;i<seen.length;i++)assert.ok(after([seen[i-1].timestamp,'',seen[i-1].id],[seen[i].timestamp,'',seen[i].id]),'order at '+seen[i].id);
 assert.deepEqual(ids,(await api.getActivities('owner',{},-1)).rows.map(r=>r.id));
 for(const pg of pages.slice(0,-1))assert.equal(pg.rows.length,50);
 // Insert mid-scroll.
 let cur=null;const two=[];for(let i=0;i<2;i++){const x=await api.getActivities('owner',{},50,cur);two.push(x);cur=x.nextCursor;}
 h.insert('activities',{id:'act_newest',user_id:'staffA',user_name:'s',action:'create',entity_type:'cash',description:'late',visible_to:'["owner"]',timestamp:'2026-09-30T23:59:59.000Z',is_deleted:0});
 h.insert('activities',{id:'act_older',user_id:'subA',user_name:'s',action:'create',entity_type:'cash',description:'back',visible_to:'["owner"]',timestamp:new Date(Date.UTC(2026,8,30-60,1,0,0)).toISOString(),is_deleted:0});
 const rest=await pageWith((l,c)=>api.getActivities('owner',{},l,c),50,cur);const restIds=rest.flatMap(pg=>pg.rows.map(r=>r.id));
 assert.ok(!restIds.includes('act_newest'));assert.equal(restIds.filter(x=>x==='act_older').length,1);
 const seq=[...two.flatMap(pg=>pg.rows.map(r=>r.id)),...restIds];assert.equal(new Set(seq).size,seq.length);assert.deepEqual(seq.filter(x=>x!=='act_older'),ids);
 // Source and store wiring.
 const db=read('src/services/database/activityDb.ts');assert.ok(/\(json_extract\(visible_to, '\$'\) LIKE '%"' \|\| \? \|\| '"%' OR user_id = \?\) AND COALESCE\(is_deleted, 0\) = 0/.test(db),'parenthesised visibility');
 assert.ok(!/LIMIT 100/.test(db));const st=read('src/store/useActivityStore.ts');assert.ok(/getActivities\(adminId, get\(\)\.filters, PAGE_SIZE, cursor\)/.test(st));
 // The dashboard no longer fetches activities: it loaded five and rendered none. The
 // bounded-query guard lives on useActivityStore above, which is the list people see.
 assert.ok(/onEndReached=\{\(\) => \{ if \(user\) loadMoreActivities\(user\.id\); \}\}/.test(read('src/screens/admin/ActivityLog.tsx')));
}));
check(91,'Purchase Book: range filter (this month) + keyset paging on orders and invoices; tab counts and day subtotals are SQL',at('src/services/database/purchaseDb.ts','getPurchaseOrderDayTotals'),()=>isolated(async h=>{
 seedPeople(h);const api=h.load('src/services/database/purchaseDb.ts');const orders=[],invoices=[];let n=0;
 h.insert('suppliers',{id:'sup1',user_id:'owner',name:'Supplier One'});
 for(let d=0;d<200;d++){const date=localDay(new Date(2026,8,30-d,12));for(let k=0;k<12;k++){n++;const created_at=date+'T'+String(8+(k%5)).padStart(2,'0')+':00:00.000Z';
  const o={id:'po_'+String(n).padStart(5,'0'),user_id:k%6===5?'otherOwner':'owner',supplier_id:'sup1',po_number:n,status:['draft','sent','received'][k%3],order_date:date,total:1000+n,received_total:k%3===2?1000+n:0,created_at,is_deleted:n%17===0?1:0};
  h.insert('purchase_orders',o);orders.push(o);
  const i={id:'pi_'+String(n).padStart(5,'0'),user_id:k%6===5?'otherOwner':'owner',supplier_id:'sup1',invoice_number:'INV'+n,invoice_date:date,subtotal:500+n,total:500+n,amount_paid:k%2?500+n:0,status:k%2?'paid':'unpaid',created_at,is_deleted:n%23===0?1:0};
  h.insert('purchase_invoices',i);invoices.push(i);}}
 assert.ok(orders.length>2000);const failures=[];
 for(const filter of [{},{startDate:'2026-09-01',endDate:'2026-09-30'},{status:'received'},{startDate:'2026-05-01',endDate:'2026-06-30',status:'paid'}]){
  const inR=(r,dk)=>(!filter.startDate||r[dk]>=filter.startDate)&&(!filter.endDate||r[dk]<=filter.endDate);
  const eo=orders.filter(r=>r.user_id==='owner'&&!r.is_deleted&&inR(r,'order_date')&&(!filter.status||r.status===filter.status));
  const ei=invoices.filter(r=>r.user_id==='owner'&&!r.is_deleted&&inR(r,'invoice_date')&&(!filter.status||r.status===filter.status));
  for(const [name,exp,fn,dayFn,dk,settledKey] of [['orders',eo,(l,c)=>api.getFilteredPurchaseOrders('owner',filter,l,c),()=>api.getPurchaseOrderDayTotals('owner',filter),'order_date','received_total'],['invoices',ei,(l,c)=>api.getFilteredPurchaseInvoices('owner',filter,l,c),()=>api.getPurchaseInvoiceDayTotals('owner',filter),'invoice_date','amount_paid']]){
   const uncapped=await fn(-1,null);const pages=await pageWith(fn);const label=name+' '+JSON.stringify(filter)+' ('+exp.length+')';
   const t0=assertPaging(label,pages,uncapped,pg=>pg.rows,pg=>pg.summary,new Set(exp.map(r=>r.id)),r=>[r[dk],r.created_at||'',r.id],failures);
   // COUNT only: the cross-currency sums that used to live here were never rendered.
   if(t0!==JSON.stringify({count:exp.length}))failures.push(label+': summary '+t0);
   const days=await dayFn();const byDay={};for(const r of exp){const dd=byDay[r[dk]]||(byDay[r[dk]]={count:0,total:0,settled:0});dd.count++;dd.total+=r.total;dd.settled+=r[settledKey];}
   if(days.length!==Object.keys(byDay).length)failures.push(label+': day rows');
   for(const d of days){const e=byDay[d.day];
    if(!e||e.count!==d.count)failures.push(label+': day '+d.day+' count');
    else for(const [f,want] of [['total',e.total],['settled',e.settled]]){
     const got=plain(d[f]);
     if(JSON.stringify(got)!==JSON.stringify([{currency:'PKR',amount:want}]))failures.push(label+': day '+d.day+' '+f);
    }}
  }
 }
 assert.equal(failures.length,0,failures.join('\n'));
 // Insert/delete mid-scroll on invoices.
 const fn=(l,c)=>api.getFilteredPurchaseInvoices('owner',{},l,c);const first=await pageWith(fn);const allBefore=first.flatMap(p=>p.rows.map(r=>r.id));
 let cur=null;const two=[];for(let i=0;i<2;i++){const x=await fn(50,cur);two.push(x);cur=x.nextCursor;}
 h.insert('purchase_invoices',{id:'pi_newest',user_id:'owner',supplier_id:'sup1',invoice_number:'N',invoice_date:'2026-09-30',subtotal:5,total:5,amount_paid:0,status:'unpaid',created_at:'2026-09-30T23:59:59.000Z',is_deleted:0});
 const olderDate=localDay(new Date(2026,8,30-60));
 h.insert('purchase_invoices',{id:'pi_older',user_id:'owner',supplier_id:'sup1',invoice_number:'O',invoice_date:olderDate,subtotal:7,total:7,amount_paid:7,status:'paid',created_at:olderDate+'T00:00:01.000Z',is_deleted:0});
 const rest=await pageWith(fn,50,cur);const restIds=rest.flatMap(p=>p.rows.map(r=>r.id));
 assert.ok(!restIds.includes('pi_newest'));assert.equal(restIds.filter(x=>x==='pi_older').length,1);
 const seq=[...two.flatMap(p=>p.rows.map(r=>r.id)),...restIds];assert.equal(new Set(seq).size,seq.length);assert.deepEqual(seq.filter(x=>x!=='pi_older'),allBefore);
 // The per-tab summary is COUNT only now (its money sums were cross-currency and were
 // never rendered). Same guarantee as before: it covers the WHOLE set, so both rows
 // inserted mid-scroll are already in it on every continued page.
 for(const x of rest)assert.equal(x.summary.count,first[0].summary.count+2);
 const two2=[];cur=null;for(let i=0;i<2;i++){const x=await fn(50,cur);two2.push(x);cur=x.nextCursor;}
 const expectedRest=(await pageWith(fn,50,cur)).flatMap(p=>p.rows.map(r=>r.id));
 h.sqlite.prepare('UPDATE purchase_invoices SET is_deleted=1 WHERE id=?').run(two2[0].rows[3].id);
 assert.deepEqual((await pageWith(fn,50,cur)).flatMap(p=>p.rows.map(r=>r.id)),expectedRest);
 await assert.rejects(()=>api.getFilteredPurchaseOrders('owner',{startDate:'2026-09-30',endDate:'2026-09-01'}),/From date/);
 // Store default + screen wiring.
 const st=read('src/store/usePurchaseStore.ts');assert.ok(/filter: \{ \.\.\.thisMonthRange\(\) \}/.test(st),'opens on this month');
 assert.ok(/getFilteredPurchaseOrders\(userId, filter, PAGE_SIZE\)/.test(st)&&/getFilteredPurchaseInvoices\(ownerId, get\(\)\.filter, PAGE_SIZE, cur\.cursor\)/.test(st));
 const sc=read('src/screens/PurchaseBook/PurchaseBookScreen.tsx');assert.ok(!/<FlatList/.test(sc));assert.equal((sc.match(/<SectionList/g)||[]).length,2);
 assert.ok(/<DateRangeFilter value=\{range\}/.test(sc)&&/Orders \(\{orderList\.summary\.count\}\)/.test(sc)&&/Invoices \(\{invoiceList\.summary\.count\}\)/.test(sc));
 assert.ok(/dayHeader\(orderList\.dayTotals, 'order', 'Received'\)/.test(sc)&&/dayHeader\(invoiceList\.dayTotals, 'invoice', 'Paid'\)/.test(sc));
}));
check(92,'Customer search is SQL, bounded and paged; both customer pickers stop loading the whole list',at('src/services/database/customerDb.ts','searchCustomers'),()=>isolated(async h=>{
 seedPeople(h);const api=customerDb(h);const rows=[];
 // subA stands in as a LEGACY sub-staff row so the CNIC redaction below is still exercised
 // against a level beneath staff; live accounts cannot be one any more.
 h.sqlite.prepare("UPDATE users SET account_level='substaff', parentId='staffA' WHERE id='subA'").run();
 const names=['Ali','Bilal','Chand','Danish','Ehsan','Farhan','Ghulam','Hamza'];let n=0;
 for(const who of ['owner','staffA','subA','staffB','subB','otherStaff'])for(let i=0;i<500;i++){n++;const row={id:'cu_'+String(n).padStart(5,'0'),user_id:who,name:names[i%8]+' '+String(i).padStart(3,'0'),phone:'03'+String(n).padStart(9,'0'),cnic:i%3?null:'34101-2345678-9',is_deleted:i%13===0?1:0};h.insert('customers',row);rows.push(row);}
 assert.equal(rows.length,3000);
 const cmp=(a,b)=>a.name.toLowerCase()<b.name.toLowerCase()?-1:a.name.toLowerCase()>b.name.toLowerCase()?1:a.id<b.id?-1:a.id>b.id?1:0;
 for(const [viewer,scope] of Object.entries(TREE))for(const q of ['','ali','AN 00','0300000012','zzz']){
  const exp=rows.filter(r=>scope.includes(r.user_id)&&!r.is_deleted&&(!q||r.name.toLowerCase().includes(q.toLowerCase())||r.phone.includes(q))).sort(cmp);
  const pages=[];let cursor=null,guard=0;do{const pg=await api.searchCustomers(viewer,q,50,cursor);pages.push(pg);cursor=pg.nextCursor;assert.ok(++guard<200);}while(cursor);
  const ids=pages.flatMap(p=>p.rows.map(r=>r.id));
  assert.deepEqual(ids,exp.map(r=>r.id),viewer+' '+JSON.stringify(q));assert.equal(new Set(ids).size,ids.length);
  for(const p of pages)assert.equal(p.total,exp.length,'count is the whole match');
  for(const p of pages.slice(0,-1))assert.equal(p.rows.length,50);
  if(viewer==='subA')for(const p of pages)assert.ok(p.rows.every(r=>r.cnic==null),'sub-staff never receives a CNIC through search');
  if(viewer==='owner'&&!q)assert.ok(pages.some(p=>p.rows.some(r=>r.cnic)),'owner does');
 }
 // Bounded initial load: the pickers ask for a page, never everything.
 const first=await api.searchCustomers('owner','',50);assert.equal(first.rows.length,50);assert.ok(first.total>=460,'the owner\'s own customers (own-only)');assert.ok(first.nextCursor);
 const typed=await api.searchCustomers('owner','hamza 49',20);assert.ok(typed.rows.length>0&&typed.rows.length<=20&&typed.rows.every(r=>r.name.toLowerCase().includes('hamza 49')));
 assert.equal((await api.searchCustomers('owner','%',50)).rows.length,0,'wildcards are literal');
 // Source guards on the three call sites.
 const book=read('src/screens/CustomerBook/CustomerBookScreen.tsx');assert.ok(!/getCustomers\(/.test(book)&&/searchCustomers\(user\.id, searchQuery, PAGE_SIZE, null, viewAs\?\.userId\)/.test(book)&&/searchCustomers\(user\.id, searchQuery, PAGE_SIZE, cursor, viewAs\?\.userId\)/.test(book));
 assert.ok(!/customers\.filter\(c =>/.test(book)&&/t\('customerTitle'\)\} \(\{total\}\)/.test(book)&&/onEndReached=\{loadMore\}/.test(book));
 const tx=read('src/screens/staff/AddTransactionScreen.tsx');assert.ok(!/getCustomers\(/.test(tx)&&/searchCustomers\(user\.id, partyName, 20\)/.test(tx)&&!/customers\.filter\(c =>/.test(tx));
 const bill=read('src/screens/BillBook/CreateNewBillModal.tsx');assert.ok(!/getCustomers\(/.test(bill)&&/searchCustomers\(userId, '', 50\)/.test(bill)&&/searchCustomers\(user\.id, customerQuery, 50\)/.test(bill)&&/searchCustomers\(user\.id, customerQuery, 50, customerCursor\)/.test(bill));
 assert.ok(/placeholder=\{t\('customerSearchPlaceholder'\)\}/.test(bill)&&/onEndReached=\{loadMoreCustomers\}/.test(bill),'picker has a search box and load-more');
}));

check(93,'staff photos: v35 adds the two nullable columns keeping every row; a saved photo round-trips across reopen and renders remote → local → initial, same pattern as customers',at(dbPath,'if (version < 35)'),()=>isolated(async h=>{
 seedPeople(h);
 // A staff row that existed before v35.
 h.insert('staff_records',{id:'staff_old',user_id:'staffA',name_en:'Old Hand',phone:'03001112222',role:'Driver',joining_date:'2026-01-01',area:'Khuzdar',business_type:'Retail',created_at:'2026-01-01T00:00:00.000Z'});
 const cols=h.all('PRAGMA table_info(staff_records)').map(c=>c.name);
 for(const c of ['photo_local_path','photo_remote_url'])assert.ok(!cols.includes(c),'v34 must not yet have '+c);
 const before=plain(h.all('SELECT * FROM staff_records ORDER BY id'));
 // Ceiling 35: this check is about what v35 does, not about 35 being the latest version.
 await h.boot(35);
 assert.equal(h.one('PRAGMA user_version').user_version,35);
 const after=h.all('PRAGMA table_info(staff_records)');
 for(const c of ['photo_local_path','photo_remote_url']){const col=after.find(x=>x.name===c);assert.ok(col,'missing '+c);assert.equal(col.notnull,0,c+' must be nullable');}
 const rows=h.all('SELECT * FROM staff_records ORDER BY id');assert.equal(rows.length,before.length);
 rows.forEach((r,i)=>{for(const [k,v]of Object.entries(before[i]))assert.equal(r[k],v,'staff_records.'+k);assert.equal(r.photo_local_path,null);assert.equal(r.photo_remote_url,null);});
 await h.boot(35);assert.deepEqual(plain(h.all('SELECT * FROM staff_records ORDER BY id')),plain(rows),'reopen must be a no-op');

 // Round trip at the latest schema: pick → durable copy → saved on the row → survives a reopen.
 await h.boot();
 const photo=h.load('src/utils/customerPhoto.ts');let api=h.load('src/services/database/staffDb.ts');
 const created={id:h.insert('staff_records',{id:'staff_photo',user_id:'staffA',name_en:'Ahmed Ali',phone:'03001234567',role:'Sales',joining_date:'2026-09-01',area:'Dubai',business_type:'Retail',status:'active',created_at:'2026-09-01T00:00:00.000Z'})};
 const picked='file:///data/user/0/com.app/cache/ImagePicker/staff.jpg';
 const durable=await photo.persistStaffPhoto(picked,created.id);
 assert.ok(durable.startsWith('test://staff_photos/'),'stored path is under documentDirectory/staff_photos: '+durable);
 assert.ok(!durable.includes('/cache/'),'never the picker cache');
 assert.deepEqual(h.files.map(f=>f.op),['mkdir','copy']);assert.equal(h.files[1].from,picked);assert.equal(h.files[1].to,durable);
 assert.equal(await photo.persistStaffPhoto(durable,created.id),durable,'already-durable path is reused');assert.equal(h.files.length,2,'no second copy');
 assert.equal(photo.isPersistedStaffPhoto(durable),true);assert.equal(photo.isPersistedStaffPhoto(picked),false);
 assert.equal(photo.isPersistedCustomerPhoto(durable),false,'staff and customer photos live in separate folders');
 await api.updateStaffPhoto(created.id,'staffA',durable);
 await h.boot();api=h.load('src/services/database/staffDb.ts');
 // The record belongs to staffA (they added the person), so the owner reads it through
 // the nested drill-down — Staff Book lists only the people each account added.
 const saved=(await api.getStaffRecords('owner','staffA')).find(s=>s.id===created.id);
 assert.ok(saved,'owner still sees the staff record after reopen');
 assert.ok(!(await api.getStaffRecords('owner')).some(s=>s.id===created.id),"not in the owner's own list");
 assert.equal(saved.photo_local_path,durable,'the durable path survives a reopen');assert.equal(saved.photo_remote_url,null);
 // Render chain: remote → local → initial (null tells CustomerAvatar to draw the initial).
 assert.equal(api.staffPhotoUri(saved),durable,'local copy when there is no remote');
 assert.equal(api.staffPhotoUri({...saved,photo_remote_url:'https://x/s.jpg'}),'https://x/s.jpg','remote wins');
 assert.equal(api.staffPhotoUri({photo_remote_url:'',photo_local_path:''}),null,'blank falls through to the initial');
 assert.equal(api.staffPhotoUri((await api.getStaffRecords('owner')).find(s=>s.id==='staff_old')),null,'a pre-v35 row shows the initial');
 assert.equal(api.staffPhotoUri(null),null);
 // The form stores ONLY the durable copy, never the picker URI, and the placeholder is gone.
 const modal=read('src/screens/StaffBook/AddStaffModal.tsx');
 assert.ok(/const durable = await persistStaffPhoto\(photoUri, created\.id\);/.test(modal)&&/updateStaffPhoto\(created\.id, user\.id, durable\)/.test(modal),'create → persist → save durable');
 assert.ok(!/updateStaffPhoto\([^)]*photoUri/.test(modal),'raw picker URI is never saved');
 assert.ok(!/Select profile picture/.test(modal)&&/pickStaffPhoto\(\)/.test(modal),'real picker, not the placeholder photo alert');
 // Every staff avatar renders through the same fallback component as customers.
 assert.ok(modal.includes('<CustomerAvatar'));
 for(const f of ['src/screens/StaffBook/StaffBookScreen.tsx','src/screens/StaffBook/StaffDetail.tsx'])assert.ok(/<CustomerAvatar[^>]*uri=\{staffPhotoUri\(/.test(read(f)),f+' renders remote → local → initial');
},34));

check(94,'Add Staff creates the login and the staff_record together, linked; the link survives a reopen; depth rules and atomicity hold; Remove keeps both rows',at('src/services/database/managedAccountDb.ts','createStaffMember'),()=>isolated(async h=>{
 seedPeople(h);let api=h.load('src/services/database/managedAccountDb.ts');
 const counts=()=>({users:h.one('SELECT COUNT(*) AS n FROM users').n,staff:h.one('SELECT COUNT(*) AS n FROM staff_records').n});
 const form=(name,phone,extra={})=>({name_en:name,phone,password:'FixturePass1',role:'Driver',joining_date:'2026-09-01',area:'Khuzdar',business_type:'Retail',monthly_salary:3000000,...extra});
 // Owner → staff: one call, a linked pair.
 h.login('owner');
 const a=await api.createStaffMember(form('Ali Staff','+92 310 5550001'));
 assert.equal(a.staff.linked_user_id,a.user.id,'profile points at its login');
 const row=h.one('SELECT * FROM staff_records WHERE id=?',a.staff.id),login=h.one('SELECT * FROM users WHERE id=?',a.user.id);
 assert.equal(row.linked_user_id,login.id);assert.equal(row.user_id,'owner','profile is scoped to its creator, as before');
 assert.equal(login.parentId,'owner');assert.equal(login.role,'staff');assert.equal(login.account_level,'staff');
 assert.equal(login.phone,'03105550001','phone stored in the form login looks up');assert.equal(row.phone,login.phone,'profile and login agree on phone');
 assert.equal(row.role,'Driver','job title stays in staff_records.role');assert.equal(row.monthly_salary,3000000);
 // Phone is the username: typed with spacing / country code, it still logs in.
 assert.equal((await users(h).verifyUserLogin('0310 5550001','FixturePass1')).id,a.user.id);
 // The link survives a reopen.
 await h.boot();api=h.load('src/services/database/managedAccountDb.ts');h.login('owner');
 assert.equal(h.one('SELECT u.id FROM staff_records s JOIN users u ON u.id=s.linked_user_id WHERE s.id=?',a.staff.id).id,a.user.id,'link survives reopen');
 assert.ok((await h.load('src/services/database/staffDb.ts').getStaffRecords('owner')).some(s=>s.id===a.staff.id&&s.linked_user_id===a.user.id),'Staff Book lists it with its link');

 // ── Step (c): a STAFF member adds their own sub-staff as a RECORD, not a login ──
 // The mode follows WHO IS ADDING and the caller cannot ask for a login: if it could,
 // a staff member's form could ask too.
 const sdb=h.load('src/services/database/staffDb.ts');
 let before=counts();
 h.login(a.user.id);
 // A sub-staff never installs the app, so no password and no number at all.
 const subForm=(name,extra={})=>({name_en:name,role:'Helper',joining_date:'2026-09-02',area:'Khuzdar',monthly_salary:1500000,...extra});
 const made=await api.createStaffMember(subForm('Record Only'));
 assert.equal(made.user,null,'a sub-staff must not come with a login');
 assert.equal(counts().users,before.users,'adding a sub-staff created a LOGIN');
 assert.equal(counts().staff,before.staff+1,'the sub-staff record was not written');
 const subRow=h.one('SELECT * FROM staff_records WHERE id=?',made.staff.id);
 assert.equal(subRow.linked_user_id,null,'a sub-staff record must point at no login');
 assert.equal(subRow.user_id,a.user.id,'the record is scoped to the staff member who added it');
 assert.equal(subRow.phone,null,'no number given must stay absent, not become an empty string or a bare dial code');
 assert.equal(subRow.monthly_salary,1500000,'salary is the whole point of the record');
 assert.equal(h.one('SELECT COUNT(*) AS n FROM users WHERE parentId=?',a.user.id).n,0,'nobody sits below a staff member');
 // Salary hangs off staff_records.id, so a person with no login still has full history.
 const sal=h.load('src/services/database/staffSalaryDb.ts');
 await sal.addStaffSalaryTransaction({staff_id:made.staff.id,user_id:a.user.id,type:'cash_out',amount:500000,date:'2026-09-10',month:'2026-09',note:''});
 assert.equal((await sal.getSalaryTotals(made.staff.id)).totalCashOut,500000,'a login-less record cannot be paid');
 // A number MAY be given; it is contact details, and it creates no login either.
 const withPhone=await api.createStaffMember(subForm('Has Number',{phone:'03009998877'}));
 assert.equal(withPhone.user,null);
 assert.equal(h.one('SELECT phone,linked_user_id FROM staff_records WHERE id=?',withPhone.staff.id).linked_user_id,null);
 // Name, role, joining date and area are still required — only login fields relaxed.
 for(const [bad,why] of [[{name_en:' '},'name'],[{role:' '},'role'],[{area:' '},'area'],[{joining_date:''},'joining date']])
  await assert.rejects(api.createStaffMember(subForm('X',bad)),/Please enter/,'a sub-staff still needs its '+why);
 // They may still open Add Staff — what it creates changes, not whether they may.
 assert.equal(await api.canCreateStaff(),true);
 // Nothing can be reached upward, as before.
 await assert.rejects(sdb.getStaffRecords(a.user.id,'owner'),/own team/,'and never upward');
 // A staff member still cannot mint a LOGIN, whatever they pass.
 await assert.rejects(api.createManagedAccount({name:'Sneaky',phone:'03005551234',password:'FixturePass1'}),/Only the owner/,
  'the login primitive is still admin-only');
 before=counts();
 // Strength and uniqueness, same rules as before.
 h.login('owner');
 await assert.rejects(api.createStaffMember(form('Weak','03105550003',{password:'abcdefgh'})),/Password must/);
 await assert.rejects(api.createStaffMember(form('Dup','0310-555-0001'.replace(/-/g,''))),/already has a login/);
 await assert.rejects(api.createStaffMember(form('No area','03105550003',{area:' '})),/area/);
 assert.deepEqual(counts(),before,'a rejected Add Staff wrote nothing to either table');
 // Atomicity: if the profile write fails AFTER the login insert, the login is rolled back too.
 h.sqlite.exec('ALTER TABLE staff_records RENAME TO staff_records_off');
 await assert.rejects(api.createStaffMember(form('Half','03105550004')));
 h.sqlite.exec('ALTER TABLE staff_records_off RENAME TO staff_records');
 assert.equal(h.one('SELECT COUNT(*) AS n FROM users WHERE phone=?','03105550004').n,0,'no login without a profile');
 assert.deepEqual(counts(),before);
 // Remove: only inside your own team; access goes, both rows stay.
 h.login('staffB');await assert.rejects(api.removeStaffAccess(a.staff.id),/own team/);
 h.login('owner');await api.removeStaffAccess(a.staff.id);
 assert.equal(h.one('SELECT is_deleted FROM users WHERE id=?',a.user.id).is_deleted,1);
 assert.equal(h.one('SELECT status,is_deleted FROM staff_records WHERE id=?',a.staff.id).status,'inactive');
 assert.equal(h.one('SELECT is_deleted FROM staff_records WHERE id=?',a.staff.id).is_deleted,0,'profile kept (salary history)');
 assert.equal(await users(h).verifyUserLogin('03105550001','FixturePass1'),null,'removed staff can no longer log in');
 assert.deepEqual(counts(),before,'nothing was deleted');
 // One creation path: the old screen and the profile-without-login function are gone.
 assert.equal(fs.existsSync(path.join(root,'src/screens/staff/SubStaffScreen.tsx')),false);
 assert.ok(!/navigate\('SubStaff'\)/.test(read('src/screens/staff/SettingsScreen.tsx')));
 for(const nav of ['src/navigation/AdminNavigator.tsx'])assert.ok(!/SubStaffScreen/.test(read(nav)),nav);
 assert.equal(h.load('src/services/database/staffDb.ts').addStaffRecord,undefined,'no profile-without-login path');
 assert.ok(/createStaffMember\(input\)/.test(read('src/store/useStaffStore.ts')),'Staff Book saves through the linked path');
 assert.ok(/removeStaffAccess\(staff\.id\)/.test(read('src/screens/StaffBook/StaffDetail.tsx')),'Remove lives on the staff profile');
}));
check(95,'dev wipe removes every non-admin login and staff profile, leaves admins able to log in, and exists only in dev builds',at('src/services/database/devWipe.ts','wipeNonAdminStaffForTesting'),()=>isolated(async h=>{
 seedPeople(h);
 const boss=await users(h).createUser('Boss','03129990000','FixturePass1','admin','admin','Boss Store');
 h.login(boss.id);const api=h.load('src/services/database/managedAccountDb.ts');
 await api.createStaffMember({name_en:'Temp',phone:'03129990001',password:'FixturePass1',role:'Driver',joining_date:'2026-09-01',area:'Khuzdar',business_type:'Retail'});
 const admins=plain(h.all("SELECT * FROM users WHERE role='admin' ORDER BY id"));
 const wipe=h.load('src/services/database/devWipe.ts');
 h.login('staffA');await assert.rejects(wipe.wipeNonAdminStaffForTesting(),/Only an admin/);
 h.login(boss.id);const r=await wipe.wipeNonAdminStaffForTesting();assert.ok(r.users>0&&r.staffRecords>0);
 assert.equal(h.one("SELECT COUNT(*) AS n FROM users WHERE role!='admin'").n,0);
 assert.equal(h.one('SELECT COUNT(*) AS n FROM staff_records').n,0);
 assert.deepEqual(plain(h.all("SELECT * FROM users WHERE role='admin' ORDER BY id")),admins,'every admin row untouched');
 assert.equal((await users(h).verifyUserLogin('03129990000','FixturePass1')).id,boss.id,'admin still logs in');
 // Fresh start: the admin can immediately add staff again.
 await h.boot();h.login(boss.id);
 const again=await h.load('src/services/database/managedAccountDb.ts').createStaffMember({name_en:'New',phone:'03129990001',password:'FixturePass1',role:'Driver',joining_date:'2026-09-01',area:'Khuzdar',business_type:'Retail'});
 assert.equal(again.staff.linked_user_id,again.user.id);
 // Dev-only: refused outside __DEV__, and the only trigger is behind __DEV__.
 assert.ok(/if \(!__DEV__\) throw/.test(read('src/services/database/devWipe.ts')));
 const settings=read('src/screens/staff/SettingsScreen.tsx');assert.ok(/__DEV__ && user\?\.role === 'admin' &&/.test(settings));
 for(const f of sourceFiles())if(!/devWipe\.ts$|SettingsScreen\.tsx$/.test(f))assert.ok(!/wipeNonAdminStaffForTesting/.test(fs.readFileSync(f,'utf8')),f+' must not call the wipe');
}));

check(120,'the sub-staff wipe removes the LEVEL: logins and their rows go, their profiles survive as no-login records with their salary, admins and staff are untouched, audit history is never deleted',at('src/services/database/devWipe.ts','wipeSubStaffLoginsForTesting'),()=>isolated(async h=>{
 seedPeople(h);
 const wipe=h.load('src/services/database/devWipe.ts');

 // The fixture has no sub-staff any more — the level is retired. This check is about
 // LEGACY rows, so it makes two itself, exactly as a pre-retirement database holds them.
 h.sqlite.prepare("UPDATE users SET account_level='substaff', parentId='staffA' WHERE id='subA'").run();
 h.sqlite.prepare("UPDATE users SET account_level='substaff', parentId='staffB' WHERE id='subB'").run();

 // Give each some work and a profile hanging off them.
 h.insert('staff_records',{id:'sr_subA',user_id:'staffA',linked_user_id:'subA',name_en:'Sub A',phone:'03001112222',role:'Helper',joining_date:'2026-01-01',area:'Quetta',status:'active',monthly_salary:1000000,is_deleted:0});
 h.insert('staff_records',{id:'sr_staffA',user_id:'owner',linked_user_id:'staffA',name_en:'Staff A',phone:'03001113333',role:'Manager',joining_date:'2026-01-01',area:'Quetta',status:'active',monthly_salary:5000000,is_deleted:0});
 h.insert('staff_salary_transactions',{id:'sal1',staff_id:'sr_subA',user_id:'staffA',type:'cash_out',amount:250000,date:date,month:'2026-09',created_at:date});
 h.insert('staff_attendance',{id:'att1',staff_id:'sr_subA',date:date,status:'present'});
 await cash(h).createCashEntry('subA','Sub-staff sale',5000,'in',date);
 await cash(h).createCashEntry('staffA','Staff sale',7000,'in',date);
 await khata(h).createTransaction('subA','A customer',9000,'lena','sub note',date);
 h.insert('bills',{id:'b_sub',user_id:'subA',bill_no:1,party_name:'P',bill_date:date,subtotal:1000,total:1000,paid:0,due:1000,status:'unpaid',is_deleted:0});
 h.insert('bill_items',{id:'bi_sub',bill_id:'b_sub',item_name:'Thing',quantity:1,unit_price:1000,line_total:1000});

 const adminsBefore=plain(h.all("SELECT * FROM users WHERE role='admin' ORDER BY id"));
 const staffBefore=plain(h.all("SELECT * FROM users WHERE account_level='staff' ORDER BY id"));

 // Only an admin may run it.
 h.login('staffA');await assert.rejects(wipe.wipeSubStaffLoginsForTesting(),/Only an admin/);

 h.login('owner');const r=await wipe.wipeSubStaffLoginsForTesting();

 // The level is gone — matched by account_level, not by role (both share role='staff').
 assert.equal(r.logins,2,'both sub-staff logins removed');
 assert.equal(h.one("SELECT COUNT(*) AS n FROM users WHERE account_level='substaff'").n,0,'no account below staff level remains');
 assert.deepEqual(plain(h.all("SELECT * FROM users WHERE role='admin' ORDER BY id")),adminsBefore,'every admin row untouched');
 assert.deepEqual(plain(h.all("SELECT * FROM users WHERE account_level='staff' ORDER BY id")),staffBefore,'every staff row untouched');

 // Their profile SURVIVES as a no-login record — that is the new model, not a deletion.
 assert.equal(r.unlinkedRecords,1);
 const kept=h.one("SELECT * FROM staff_records WHERE id='sr_subA'");
 assert.ok(kept,'the sub-staff profile is kept');
 assert.equal(kept.linked_user_id,null,'and carries no login');
 assert.equal(kept.name_en,'Sub A');assert.equal(kept.monthly_salary,1000000,'its salary is untouched');
 assert.equal(h.one("SELECT COUNT(*) AS n FROM staff_salary_transactions WHERE staff_id='sr_subA'").n,1,'salary history hangs off staff_id and survives');
 assert.equal(h.one("SELECT COUNT(*) AS n FROM staff_attendance WHERE staff_id='sr_subA'").n,1,'so does attendance');
 assert.equal(h.one("SELECT linked_user_id AS l FROM staff_records WHERE id='sr_staffA'").l,'staffA','a staff profile keeps ITS login');

 // The rows they wrote are gone; everyone else's are not.
 assert.equal(h.one("SELECT COUNT(*) AS n FROM cashbook WHERE userId='subA'").n,0);
 assert.equal(h.one("SELECT COUNT(*) AS n FROM cashbook WHERE userId='staffA'").n,1,"another account's entries are untouched");
 assert.equal(h.one("SELECT COUNT(*) AS n FROM transactions WHERE userId='subA'").n,0);
 assert.equal(h.one("SELECT COUNT(*) AS n FROM bills WHERE user_id='subA'").n,0);
 assert.equal(h.one("SELECT COUNT(*) AS n FROM bill_items WHERE bill_id='b_sub'").n,0,'orphaned bill lines go with their bill');
 assert.ok(r.entries.cashbook>=1&&r.entries.bills>=1,'the result names what it deleted, per table');

 // Running it twice is a no-op, not an error.
 const again=await wipe.wipeSubStaffLoginsForTesting();
 assert.deepEqual(plain(again),{logins:0,unlinkedRecords:0,entries:{}},'idempotent');

 // Dev-only, and the only trigger is behind __DEV__.
 const src=read('src/services/database/devWipe.ts');
 assert.ok(/export async function wipeSubStaffLoginsForTesting[\s\S]*?if \(!__DEV__\) throw/.test(src),'refused outside a dev build');
 assert.ok(!/DELETE FROM entry_audit/.test(src),'entry history is append-only and is never deleted');
 const settings=read('src/screens/staff/SettingsScreen.tsx');
 assert.ok(/__DEV__ && user\?\.role === 'admin' &&[\s\S]*wipeSubStaffLoginsForTesting/.test(settings),'its button is dev-only and admin-only');
 for(const file of sourceFiles())if(!/devWipe\.ts$|SettingsScreen\.tsx$/.test(file))assert.ok(!/wipeSubStaffLoginsForTesting/.test(fs.readFileSync(file,'utf8')),file+' must not call the wipe');
}));

check(96,'v37 makes staff_records.business_type optional without losing a row or a column, and Add Staff stops demanding it',at(dbPath,'if (version < 37)'),()=>isolated(async h=>{
 seedPeople(h);
 h.insert('staff_records',{id:'staff_bt',user_id:'staffA',name_en:'Has Type',phone:'03007770001',role:'Driver',joining_date:'2026-01-01',area:'Khuzdar',business_type:'Retail',monthly_salary:500000,created_at:'2026-01-01T00:00:00.000Z'});
 assert.equal(h.all('PRAGMA table_info(staff_records)').find(c=>c.name==='business_type').notnull,1,'v36 still requires it');
 const before=plain(h.all('SELECT * FROM staff_records ORDER BY id'));
 const beforeCols=h.all('PRAGMA table_info(staff_records)').map(c=>c.name);
 await h.boot(37);
 assert.equal(h.one('PRAGMA user_version').user_version,37);
 const cols=h.all('PRAGMA table_info(staff_records)');
 assert.equal(cols.find(c=>c.name==='business_type').notnull,0,'business_type is optional');
 for(const c of beforeCols)assert.ok(cols.some(x=>x.name===c),'rebuild dropped column '+c);
 for(const c of ['area','name_en','phone','role','joining_date'])assert.equal(cols.find(x=>x.name===c).notnull,1,c+' stays required');
 assert.deepEqual(plain(h.all('SELECT * FROM staff_records ORDER BY id')),before,'every row and value preserved');
 assert.deepEqual(sorted(h.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='staff_records' AND name LIKE 'idx_%'").map(r=>({id:r.name}))),
  sorted([{id:'idx_staff_user_id'},{id:'idx_staff_name'},{id:'idx_staff_phone'},{id:'idx_staff_linked_user'}]),'indexes put back');
 await h.boot(37);assert.deepEqual(plain(h.all('SELECT * FROM staff_records ORDER BY id')),before,'reopen must be a no-op');
 // A staff member can now be added with no business type; area is still required.
 await h.boot();h.login('owner');
 const api=h.load('src/services/database/managedAccountDb.ts');
 const made=await api.createStaffMember({name_en:'No Type',phone:'03007770002',password:'FixturePass1',role:'Driver',joining_date:'2026-09-01',area:'Dubai'});
 assert.equal(h.one('SELECT business_type FROM staff_records WHERE id=?',made.staff.id).business_type,null);
 await assert.rejects(api.createStaffMember({name_en:'No Area',phone:'03007770003',password:'FixturePass1',role:'Driver',joining_date:'2026-09-01',area:'  '}),/area/);
 const modal=read('src/screens/StaffBook/AddStaffModal.tsx');
 assert.ok(!/businessType = 'Business type required'/.test(modal),'form no longer demands a business type');
 assert.ok(/t\('staffAreaLabel'\)\} \*/.test(modal),'area is still marked required');
},36));
check(97,'Staff Book and Global Search both open the HR profile, which accepts a record or an id',at('src/screens/StaffBook/StaffDetail.tsx','getStaffRecordById'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const made=await h.load('src/services/database/managedAccountDb.ts').createStaffMember({name_en:'Route Test',phone:'03008880001',password:'FixturePass1',role:'Driver',joining_date:'2026-09-01',area:'Khuzdar'});
 const api=h.load('src/services/database/staffDb.ts');
 // Global Search knows only the id; the profile loads it, inside the viewer's own tree.
 assert.equal((await api.getStaffRecordById('owner',made.staff.id)).id,made.staff.id);
 assert.equal(await api.getStaffRecordById('otherOwner',made.staff.id),null,'another business cannot load it');
 assert.equal(await api.getStaffRecordById('owner','nope'),null);
 // Both entry points name the HR profile route, not the users-row screen.
 assert.ok(/navigate\('StaffDetailBook', \{ staff: item \}\)/.test(read('src/screens/StaffBook/StaffBookScreen.tsx')),'Staff Book opens the HR profile');
 assert.ok(/navigate\('StaffDetailBook', \{ staffId: item\.id \}\)/.test(read('src/screens/search/GlobalSearchScreen.tsx')),'Global Search passes an id the profile understands');
 for(const nav of ['src/navigation/AdminNavigator.tsx'])
  assert.ok(/name="StaffDetailBook" component=\{StaffDetail\}/.test(read(nav)),nav+' registers the HR profile route');
 const screen=read('src/screens/StaffBook/StaffDetail.tsx');
 assert.ok(/route\.params\?\.staff\?\.id \?\? route\.params\?\.staffId/.test(screen),'accepts a record or an id');
}));

check(98,'a salary entered in rupees reads back as the same rupees everywhere, and salary figures are SQL aggregates that do not depend on the loaded rows',at('src/screens/StaffBook/StaffSalaryDetailScreen.tsx','paisaToRupeesString(remainingDue)'),()=>isolated(async h=>{
 seedPeople(h);
 const calc=h.load('src/utils/calculations.ts'),sal=h.load('src/services/database/staffSalaryDb.ts'),staffApi=h.load('src/services/database/staffDb.ts');
 // Rs 30 typed in → paisa stored → Rs 30 back out. No hop may add or drop a 100×.
 const stored=calc.rupeesToPaisa('30');assert.equal(stored,3000,'rupees are stored as paisa');
 assert.equal(calc.paisaToRupeesString(stored),'30','the pre-fill converter returns rupees, not paisa');
 assert.equal(calc.formatCurrency(stored),'Rs. 30','display converts exactly once');
 assert.equal(calc.rupeesToPaisa(calc.paisaToRupeesString(stored)),stored,'pre-fill → save is a round trip');
 h.insert('staff_records',{id:'staff_pay',user_id:'staffA',name_en:'ROW_staffA',phone:'03004440001',role:'Driver',joining_date:'2026-09-01',area:'Khuzdar',monthly_salary:stored,created_at:'2026-09-01T00:00:00.000Z'});
 await staffApi.updateStaffSalary('staff_pay','staffA',stored);
 assert.equal(h.one('SELECT monthly_salary FROM staff_records WHERE id=?','staff_pay').monthly_salary,stored,'the column holds paisa');
 assert.equal(calc.formatCurrency((await staffApi.getStaffRecordById('owner','staff_pay')).monthly_salary),'Rs. 30','profile/salary screen show Rs 30');
 // The Pay salary pre-fill is what showed "3000" for a Rs 30 salary.
 const screen=read('src/screens/StaffBook/StaffSalaryDetailScreen.tsx');
 assert.ok(/setInputAmount\(remainingDue > 0 \? paisaToRupeesString\(remainingDue\) : ''\)/.test(screen),'pre-fill converts paisa → rupees');
 assert.ok(!/remainingDue\.toString\(\)/.test(screen),'the raw paisa pre-fill must not come back');
 assert.ok(!/Math\.round\(valRupees \* 100\)/.test(screen),'no hand-written × 100; rupeesToPaisa does it');
 assert.ok(/rupeesToPaisa\(typed\)/.test(screen),'set-salary input goes through the shared converter');
 // Figures are SQL: identical whether the screen loaded 1 row or 20.
 const paid=[];for(let i=0;i<20;i++){paid.push(500);h.insert('staff_salary_transactions',{id:'sal_'+i,staff_id:'staff_pay',user_id:'staffA',type:'cash_out',amount:500,date:'2026-09-'+String(i%28+1).padStart(2,'0'),month:'2026-09',created_at:'2026-09-01T00:00:00.000Z',is_deleted:0});}
 h.insert('staff_salary_transactions',{id:'sal_back',staff_id:'staff_pay',user_id:'staffA',type:'cash_in',amount:200,date:'2026-09-05',month:'2026-09',created_at:'2026-09-01T00:00:00.000Z',is_deleted:0});
 h.insert('staff_salary_transactions',{id:'sal_other',staff_id:'staff_pay',user_id:'staffA',type:'cash_out',amount:900,date:'2026-08-05',month:'2026-08',created_at:'2026-08-01T00:00:00.000Z',is_deleted:0});
 h.insert('staff_salary_transactions',{id:'sal_gone',staff_id:'staff_pay',user_id:'staffA',type:'cash_out',amount:7777,date:'2026-09-06',month:'2026-09',created_at:'2026-09-01T00:00:00.000Z',is_deleted:1});
 const month=await sal.getSalaryTotals('staff_pay','2026-09');
 assert.equal(month.totalCashOut,paid.reduce((a,b)=>a+b,0),'month total is every matching row, deleted ones excluded');
 assert.equal(month.totalCashIn,200);assert.equal(month.count,21);
 const all=await sal.getSalaryTotals('staff_pay');
 assert.equal(all.totalCashOut,month.totalCashOut+900,'all-time includes other months');
 assert.equal((await sal.getSalaryTotals('staff_pay','ALL')).totalCashOut,all.totalCashOut,"'ALL' means every month");
 // One page or twenty: the aggregate is over the whole set, so the figure cannot move.
 const page=(await sal.getSalaryTransactionsByStaffId('staff_pay')).slice(0,1);
 assert.equal(page.length,1);
 assert.equal((await sal.getSalaryTotals('staff_pay','2026-09')).totalCashOut,month.totalCashOut,'loading fewer rows does not change the figure');
 assert.ok(!/const monthlyStats = useMemo|const allTimeStats = useMemo/.test(screen),'figures are not summed from loaded rows');
 // Remaining due follows from the same paisa figures.
 const remaining=Math.max(0,stored-month.totalCashOut);
 assert.equal(calc.formatCurrency(remaining),'Rs. 0','Rs 30 salary, Rs 100 paid → nothing remaining');
 assert.equal(calc.formatCurrency(Math.max(0,stored-500)),'Rs. 25','Rs 30 salary, Rs 5 paid → Rs 25 remaining');
 // Exports show the same rupees as the screen.
 const html=await report(h,'staff','staffA');
 assert.ok(html.includes('Rs. 30'),'PDF shows Rs 30');assert.ok(!html.includes('>3000<'),'PDF must not print raw paisa');
}));

check(99,'overpayment carries forward as an advance: closing a month snapshots it, the next month opens at salary − advance, and an advance larger than a month chains onward',at('src/services/database/salaryClosingDb.ts','closeSalaryMonth'),()=>isolated(async h=>{
 seedPeople(h);const api=h.load('src/services/database/salaryClosingDb.ts'),calc=h.load('src/utils/calculations.ts');
 const SALARY=calc.rupeesToPaisa('10000');
 // Months are relative to today: a month in the future cannot be closed, so a fixed
 // calendar year would make this test rot.
 const now=new Date();
 const M=back=>{const d=new Date(now.getFullYear(),now.getMonth()-back,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
 const [m1,m2,m3,m4]=[M(3),M(2),M(1),M(0)];
 h.insert('staff_records',{id:'staff_adv',user_id:'owner',linked_user_id:'staffA',name_en:'Advance Test',phone:'03005550001',role:'Driver',joining_date:m1+'-01',area:'Khuzdar',monthly_salary:SALARY,created_at:m1+'-01T00:00:00.000Z'});
 let seq=0;
 const pay=(month,day,rupees,type='cash_out')=>h.insert('staff_salary_transactions',{id:'sp_'+(seq++),staff_id:'staff_adv',user_id:'owner',type,amount:calc.rupeesToPaisa(String(rupees)),date:month+'-'+day,month,created_at:month+'-'+day+'T00:00:00.000Z',is_deleted:0});
 h.login('owner');

 // Paying EXACTLY the salary: nothing remaining, and no Extra paid to render.
 pay(m1,'05',10000);
 let first=await api.getSalaryMonthState('staff_adv',m1);
 assert.equal(first.duePaisa,SALARY);assert.equal(first.paidPaisa,SALARY);
 assert.equal(first.remainingPaisa,0,'nothing left');assert.equal(first.extraPaidPaisa,0,'no overpayment, so nothing to show');

 // Paying ABOVE: the excess is the extra, remaining stays at zero.
 pay(m1,'20',2000);
 first=await api.getSalaryMonthState('staff_adv',m1);
 assert.equal(first.paidPaisa,calc.rupeesToPaisa('12000'));
 assert.equal(first.remainingPaisa,0);
 assert.equal(first.extraPaidPaisa,calc.rupeesToPaisa('2000'),'extra equals the excess');

 // Until the month is closed nothing carries: no invented arrears or credits.
 assert.equal((await api.getSalaryMonthState('staff_adv',m2)).openingAdvancePaisa,0);
 assert.equal((await api.getSalaryMonthState('staff_adv',m2)).duePaisa,SALARY);

 // Closing the first month hands the advance to the next.
 const { closing, nextMonth } = await api.closeSalaryMonth('staff_adv',m1);
 assert.equal(nextMonth,m2);
 assert.equal(closing.salary_paisa,SALARY,'the snapshot keeps the salary that applied');
 assert.equal(closing.paid_paisa,calc.rupeesToPaisa('12000'));
 assert.equal(closing.carry_advance_paisa,calc.rupeesToPaisa('2000'));
 let second=await api.getSalaryMonthState('staff_adv',m2);
 assert.equal(second.openingAdvancePaisa,calc.rupeesToPaisa('2000'));
 assert.equal(second.duePaisa,calc.rupeesToPaisa('8000'),'next month opens at salary minus the advance');
 assert.equal(second.advanceFromMonth,m1,'the screen can say where the advance came from');
 assert.equal(second.remainingPaisa,calc.rupeesToPaisa('8000'));assert.equal(second.extraPaidPaisa,0);

 // Raising the salary later must not rewrite the closed month.
 h.sqlite.prepare('UPDATE staff_records SET monthly_salary=? WHERE id=?').run(calc.rupeesToPaisa('12000'),'staff_adv');
 assert.equal((await api.getSalaryClosings('staff_adv'))[0].salary_paisa,SALARY,'a closed month stays at its own salary');
 h.sqlite.prepare('UPDATE staff_records SET monthly_salary=? WHERE id=?').run(SALARY,'staff_adv');

 // An advance BIGGER than a whole month zeroes that month and chains onward.
 pay(m2,'03',25000);
 second=await api.getSalaryMonthState('staff_adv',m2);
 assert.equal(second.extraPaidPaisa,calc.rupeesToPaisa('17000'),'25,000 against an 8,000 due');
 await api.closeSalaryMonth('staff_adv',m2);
 const third=await api.getSalaryMonthState('staff_adv',m3);
 assert.equal(third.duePaisa,0,'a 17,000 advance swallows the 10,000 month');
 assert.equal(third.remainingPaisa,0);
 await api.closeSalaryMonth('staff_adv',m3);
 const fourth=await api.getSalaryMonthState('staff_adv',m4);
 assert.equal(fourth.openingAdvancePaisa,calc.rupeesToPaisa('7000'),'the remainder carries to the month after');
 assert.equal(fourth.duePaisa,calc.rupeesToPaisa('3000'));

 // Nothing is locked: a payment into a closed month makes it drift, and re-closing appends.
 pay(m1,'28',500);
 assert.equal((await api.getSalaryMonthState('staff_adv',m1)).drifted,true,'a closed month that changed says so');
 const before=(await api.getSalaryClosings('staff_adv')).length;
 await api.closeSalaryMonth('staff_adv',m1);
 assert.equal((await api.getSalaryClosings('staff_adv')).length,before+1,'re-closing appends a snapshot, never overwrites');

 // Figures are SQL: byte-identical however many rows a screen has loaded.
 const state1=await api.getSalaryMonthState('staff_adv',m2);
 for(let i=0;i<20;i++)pay(m4,'1'+(i%9),1);
 assert.deepEqual(plain(await api.getSalaryMonthState('staff_adv',m2)),plain(state1),'one month is unaffected by twenty rows in another');

 // Permission: a peer account is refused by team; another branch is refused; the future is refused.
 h.login('subA');assert.equal(await api.canCloseSalaryMonthFor('staff_adv'),false);
 await assert.rejects(api.closeSalaryMonth('staff_adv',m1),/your own team/);
 h.login('staffB');await assert.rejects(api.closeSalaryMonth('staff_adv',m1),/your own team/);
 h.login('owner');await assert.rejects(api.closeSalaryMonth('staff_adv','2099-01'),/future month/);
 assert.equal(api.mayCloseSalaryMonth({role:'staff',account_level:'substaff'}),false);
 assert.equal(api.mayCloseSalaryMonth({role:'staff',account_level:'staff'}),true);
 assert.equal(api.nextMonthKey('2026-12'),'2027-01','December rolls into January');

 // Screen: Extra paid renders only when it exists, in neutral ink, and a reduced due explains itself.
 const screen=read('src/screens/StaffBook/StaffSalaryDetailScreen.tsx');
 assert.ok(/\{extraPaid > 0 && \(/.test(screen),'no Rs 0 placeholder');
 // Both lines are translated now; the screen must still SAY what it carried forward and why.
 assert.ok(/t\('salaryExtraPaid'\)/.test(screen)&&/salaryAdvanceApplied/.test(screen));
 const extraBlock=screen.slice(screen.indexOf('Extra paid'),screen.indexOf('advance from'));
 assert.ok(!/moneyIn|moneyOut|attention/.test(extraBlock),'Extra paid is neutral ink');
 assert.ok(/remainingDue > 0 && \{ color: color\.attention \}/.test(screen),'Remaining due stays amber');
 assert.equal((screen.match(/#[0-9A-Fa-f]{3,6}\b/g)||[]).length,0,'tokens only');
}));

check(100,'upgrading an EXISTING database reaches the latest version: v38 creates salary_month_closings on a v37 database and every pre-existing row survives',at(dbPath,'if (version < 38)'),()=>isolated(async h=>{
 seedPeople(h);
 // A device that has been in use since before the salary work.
 h.insert('staff_records',{id:'staff_live',user_id:'staffA',name_en:'In Use',phone:'03006660001',role:'Driver',joining_date:'2026-01-01',area:'Khuzdar',business_type:'Retail',monthly_salary:300000,created_at:'2026-01-01T00:00:00.000Z'});
 h.insert('staff_salary_transactions',{id:'sal_live',staff_id:'staff_live',user_id:'staffA',type:'cash_out',amount:150000,date:'2026-09-05',month:'2026-09',created_at:'2026-09-05T00:00:00.000Z',is_deleted:0});
 // Exactly the device's state: a v37 database with no salary_month_closings.
 h.sqlite.exec('DROP TABLE IF EXISTS salary_month_closings');
 assert.equal(h.all("SELECT name FROM sqlite_master WHERE type='table' AND name='salary_month_closings'").length,0,'table is missing, as on the phone');
 const staffBefore=plain(h.all('SELECT * FROM staff_records ORDER BY id'));
 const payBefore=plain(h.all('SELECT * FROM staff_salary_transactions ORDER BY id'));

 await h.boot(); // the upgrade a real device performs on next launch

 assert.equal(h.one('PRAGMA user_version').user_version,latest,'the chain reached the latest version');
 assert.equal(h.all("SELECT name FROM sqlite_master WHERE type='table' AND name='salary_month_closings'").length,1,'the table exists after upgrading, not only on a fresh install');
 for(const idx of ['idx_salary_closing_staff','idx_salary_closing_user'])
  assert.equal(h.all("SELECT name FROM sqlite_master WHERE type='index' AND name=?",idx).length,1,'missing '+idx);
 assert.deepEqual(plain(h.all('SELECT * FROM staff_records ORDER BY id')),staffBefore,'staff rows untouched');
 assert.deepEqual(plain(h.all('SELECT * FROM staff_salary_transactions ORDER BY id')),payBefore,'salary rows untouched');
 // The feature actually works on the upgraded database.
 h.login('owner');
 const sal=h.load('src/services/database/salaryClosingDb.ts');
 const state=await sal.getSalaryMonthState('staff_live','2026-09');
 assert.equal(state.paidPaisa,150000);assert.equal(state.remainingPaisa,150000);
 await h.boot();assert.equal(h.one('PRAGMA user_version').user_version,latest,'reopening is a no-op');
 // Belt and braces: the table is declared in BOTH the migration and the base schema.
 const dbSrc=read(dbPath);
 assert.ok(/if \(version < 38\)[\s\S]*CREATE TABLE IF NOT EXISTS salary_month_closings/.test(dbSrc),'v38 creates it');
 assert.ok(dbSrc.indexOf('CREATE TABLE IF NOT EXISTS salary_month_closings')<dbSrc.indexOf('async function runMigrations'),'and the base schema does too');
},37));
check(101,'a migration never aborts the chain over a column it does not recognise: an unknown column is carried across and every later migration still runs',at(dbPath,'carriedDefs'),()=>isolated(async h=>{
 seedPeople(h);
 // A real device accumulates columns no test fixture has. Before the fix, ONE of these
 // made v37 throw, which stopped v38 — the "no such table: salary_month_closings" crash.
 h.sqlite.exec("ALTER TABLE staff_records ADD COLUMN legacy_note TEXT");
 h.insert('staff_records',{id:'staff_odd',user_id:'staffA',name_en:'Odd Columns',phone:'03007770001',role:'Driver',joining_date:'2026-01-01',area:'Khuzdar',business_type:'Retail',monthly_salary:250000,legacy_note:'keep me',created_at:'2026-01-01T00:00:00.000Z'});
 const before=plain(h.all('SELECT * FROM staff_records ORDER BY id'));

 await h.boot();

 assert.equal(h.one('PRAGMA user_version').user_version,latest,'the chain completed despite the unfamiliar column');
 const cols=h.all('PRAGMA table_info(staff_records)');
 assert.ok(cols.some(c=>c.name==='legacy_note'),'the unknown column survived the rebuild');
 assert.equal(cols.find(c=>c.name==='business_type').notnull,0,'v37 still did its job');
 assert.equal(h.one('SELECT legacy_note FROM staff_records WHERE id=?','staff_odd').legacy_note,'keep me','its data survived');
 assert.deepEqual(plain(h.all('SELECT * FROM staff_records ORDER BY id')),before,'every row and value preserved');
 assert.equal(h.all("SELECT name FROM sqlite_master WHERE type='table' AND name='salary_month_closings'").length,1,'the later migration ran');
 // A stalled chain must be loud, not swallowed.
 const src=read('src/services/database/db.ts');
 assert.ok(/Schema migration stalled at v\$\{stalled\}/.test(src),'a failure names the version it stalled on');
 assert.ok(/throw new Error\(message\)/.test(src),'and is rethrown, not logged and forgotten');
 assert.ok(/Alert\.alert\(t\('dbProblemTitle'\)/.test(read('src/navigation/AppNavigator.tsx')),'startup surfaces it to the user');
},36));

check(102,'staff documents are real picked files: copied under documentDirectory, only the durable path stored, and the invented placeholder name is gone',at('src/utils/customerPhoto.ts','persistStaffDocument'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const photo=h.load('src/utils/customerPhoto.ts'),staffApi=h.load('src/services/database/staffDb.ts');
 const made=await h.load('src/services/database/managedAccountDb.ts').createStaffMember({name_en:'Doc Holder',phone:'03009990001',password:'FixturePass1',role:'Driver',joining_date:'2026-09-01',area:'Khuzdar'});
 const picked=['file:///data/user/0/com.app/cache/ImagePicker/cnic.jpg','file:///data/user/0/com.app/cache/ImagePicker/contract.jpg'];
 const durable=[];for(const p of picked)durable.push(await photo.persistStaffDocument(p,made.staff.id));
 for(const d of durable){
  assert.ok(d.startsWith('test://staff_docs/'),'filed under documentDirectory/staff_docs: '+d);
  assert.ok(!d.includes('/cache/'),'never the picker cache');
 }
 assert.notEqual(durable[0],durable[1],'two documents do not collide');
 assert.deepEqual(h.files.map(f=>f.op),['mkdir','copy','mkdir','copy']);
 assert.equal(await photo.persistStaffDocument(durable[0],made.staff.id),durable[0],'an already-durable path is reused');
 assert.equal(h.files.length,4,'no second copy');
 assert.equal(photo.isPersistedStaffDocument(durable[0]),true);
 assert.equal(photo.isPersistedStaffDocument(picked[0]),false);
 assert.equal(photo.isPersistedStaffPhoto(durable[0]),false,'documents and photos live in separate folders');
 // Stored as the JSON the reader parses, and it survives a reopen.
 await staffApi.updateStaffDocuments(made.staff.id,'owner',durable);
 await h.boot();
 const reloaded=await h.load('src/services/database/staffDb.ts').getStaffRecordById('owner',made.staff.id);
 assert.deepEqual(plain(reloaded.document_urls),durable,'documents round-trip through the database');
 await h.load('src/services/database/staffDb.ts').updateStaffDocuments(made.staff.id,'owner',[]);
 assert.equal(h.one('SELECT document_urls FROM staff_records WHERE id=?',made.staff.id).document_urls,null,'clearing them stores NULL, not "[]"');
 // A human-readable label, not the whole path.
 assert.equal(photo.documentLabel('test://staff_docs/staff_1_99.jpg'),'staff_1_99.jpg');
 // The form picks a real file and stores only durable copies.
 const modal=read('src/screens/StaffBook/AddStaffModal.tsx');
 assert.ok(!/doc_\$\{Date\.now\(\)\}\.pdf/.test(modal),'the invented filename placeholder is gone');
 assert.ok(!/Select document to upload/.test(modal),'the placeholder alert is gone');
 assert.ok(/await pickStaffDocument\(\)/.test(modal),'a real picker runs');
 assert.ok(/durableDocs\.push\(await persistStaffDocument\(doc, created\.id\)\)/.test(modal)&&/updateStaffDocuments\(created\.id, user\.id, durableDocs\)/.test(modal),'only the durable copies are saved');
 for(const f of ['src/screens/StaffBook/AddStaffModal.tsx','src/screens/StaffBook/StaffDetail.tsx'])
  assert.ok(/documentLabel\(doc\)/.test(read(f)),f+' shows the file name, not the path');
}));

check(103,'a newly attached file lands in permanent storage at every save site; only the durable path is saved',at('src/utils/durableFile.ts','persistAttachment'),()=>isolated(async h=>{
 const df=h.load('src/utils/durableFile.ts');
 const folders={cash:'cash_attachments',bill:'bill_attachments',expense:'expense_receipts',item:'item_photos',profile:'profile_photos'};
 for(const [kind,folder] of Object.entries(folders)){
  const picked=`file:///data/user/0/com.app/cache/ImagePicker/${kind}.jpg`;
  const durable=await df.persistAttachment(kind,picked);
  assert.ok(durable.startsWith(`test://${folder}/`),kind+' filed under documentDirectory/'+folder+': '+durable);
  assert.ok(!durable.includes('/cache/'),kind+' never keeps the cache path');
  assert.equal(await df.persistAttachment(kind,durable),durable,kind+': re-saving (editing) does not copy again');
 }
 assert.equal(await df.persistAttachment('cash','https://example.com/r.jpg'),'https://example.com/r.jpg','a remote URL is not a device file');
 // Customer and staff photos go through the SAME copy helper — one approach, not three.
 assert.ok(/import \{ isUnder, persistInto \} from '\.\/durableFile'/.test(read('src/utils/customerPhoto.ts')));
 assert.ok(!/const persistInto =/.test(read('src/utils/customerPhoto.ts')),'no second copy of the helper');
 // Every save site copies before saving and stores only the durable path.
 const sites=[
  ['src/screens/CashBook/CashEntryModal.tsx',/const durableAttachment = attachmentUrl \? await persistAttachment\('cash', attachmentUrl\)/,/attachment_url: durableAttachment/],
  ['src/screens/BillBook/CreateNewBillModal.tsx',/durableAttachments\.push\(await persistAttachment\('bill', a\)\)/,/attachment_urls: durableAttachments\.length > 0 \? durableAttachments/],
  ['src/screens/ExpenseBook/AddExpenseModal.tsx',/persistAttachment\('expense', receiptUrl\)/,/receipt_url: durableReceipt/],
  ['src/screens/StockBook/AddItemModal.tsx',/persistAttachment\('item', pictureUrl\)/,/picture_url: durablePicture/],
  ['src/screens/staff/SettingsScreen.tsx',/persistAttachment\('profile', uri\)/,/updateProfilePicture\(user\.id, durable\)/],
 ];
 for(const [f,copies,saves] of sites){const s=read(f);assert.ok(copies.test(s),f+' copies to permanent storage');assert.ok(saves.test(s),f+' saves only the durable path');}
 assert.ok(!/attachmentUrl \|\| null, category/.test(read('src/screens/CashBook/CashEntryModal.tsx')),'cash create no longer saves the raw picker path');
}));
check(104,'upgrading an EXISTING database repairs old attachments: survivors are copied and repointed, lost files are kept and recorded, placeholders removed, nothing deleted',at(dbPath,'if (version < 39)'),()=>isolated(async h=>{
 seedPeople(h);
 const cache=n=>`file:///data/user/0/com.app/cache/ImagePicker/${n}.jpg`;
 // A device from before durable storage: a mix of files that survived and files Android cleared.
 h.insert('cashbook',{id:'cash_alive',userId:'staffA',attachment_url:cache('cash-alive')});h.present.add(cache('cash-alive'));
 h.insert('cashbook',{id:'cash_gone',userId:'staffA',attachment_url:cache('cash-gone')});
 h.insert('cashbook',{id:'cash_remote',userId:'staffA',attachment_url:'https://example.com/r.jpg'});
 h.insert('expenses',{id:'exp_alive',user_id:'staffA',receipt_url:cache('exp-alive')});h.present.add(cache('exp-alive'));
 h.insert('bills',{id:'bill_mixed',user_id:'staffA',attachment_urls:JSON.stringify([cache('bill-alive'),cache('bill-gone')])});h.present.add(cache('bill-alive'));
 h.insert('stock_items',{id:'item_ok',user_id:'staffA',picture_url:'test://item_photos/already.jpg'});
 h.sqlite.prepare('UPDATE users SET pictureUrl=? WHERE id=?').run(cache('profile-alive'),'owner');h.present.add(cache('profile-alive'));
 h.insert('staff_records',{id:'staff_docs',user_id:'staffA',name_en:'Docs',phone:'03001110000',role:'Driver',joining_date:'2026-01-01',area:'K',created_at:'2026-01-01T00:00:00.000Z',
  document_urls:JSON.stringify(['test://staff_docs/real.jpg','doc_1726000000000.pdf'])});
 const counts=()=>Object.fromEntries(['cashbook','expenses','bills','stock_items','users','staff_records'].map(t=>[t,h.one(`SELECT COUNT(*) AS n FROM ${t}`).n]));
 const before=counts();

 await h.boot(); // what the phone does on its next launch

 assert.equal(h.one('PRAGMA user_version').user_version,latest,'the chain reached the latest version');
 assert.deepEqual(counts(),before,'no row was deleted');
 const val=(t,c,id)=>h.one(`SELECT ${c} AS v FROM ${t} WHERE id=?`,id).v;
 // Survivors: copied, repointed, and the copy came from the original cache file.
 const cashNow=val('cashbook','attachment_url','cash_alive');
 assert.ok(cashNow.startsWith('test://cash_attachments/'),'surviving cash file repointed: '+cashNow);
 assert.ok(h.files.some(f=>f.op==='copy'&&f.from===cache('cash-alive')&&f.to===cashNow),'copied from the old cache path');
 assert.ok(val('expenses','receipt_url','exp_alive').startsWith('test://expense_receipts/'));
 assert.ok(val('users','pictureUrl','owner').startsWith('test://profile_photos/'));
 // Lost: the row keeps its original path, and the loss is recorded.
 assert.equal(val('cashbook','attachment_url','cash_gone'),cache('cash-gone'),'a lost file keeps its original path');
 const lost=h.all('SELECT table_name, record_id, original_path FROM lost_attachments ORDER BY record_id');
 assert.deepEqual(plain(lost),[
  {table_name:'bills',record_id:'bill_mixed',original_path:cache('bill-gone')},
  {table_name:'cashbook',record_id:'cash_gone',original_path:cache('cash-gone')},
 ],'exactly the lost files are recorded');
 // A bill is repaired file by file: one survivor copied, one loss kept in place.
 const billNow=JSON.parse(val('bills','attachment_urls','bill_mixed'));
 assert.equal(billNow.length,2,'no bill attachment was dropped');
 assert.ok(billNow[0].startsWith('test://bill_attachments/'));assert.equal(billNow[1],cache('bill-gone'));
 // Already durable and remote paths are left exactly as they were.
 assert.equal(val('stock_items','picture_url','item_ok'),'test://item_photos/already.jpg');
 assert.equal(val('cashbook','attachment_url','cash_remote'),'https://example.com/r.jpg');
 // Placeholder staff documents go; real ones stay.
 assert.deepEqual(JSON.parse(val('staff_records','document_urls','staff_docs')),['test://staff_docs/real.jpg']);
 // Re-running is a no-op: no new copies, no duplicate losses, nothing moves.
 const snapshot=plain(['cashbook','expenses','bills','stock_items','users','staff_records'].map(t=>h.all(`SELECT * FROM ${t} ORDER BY id`)));
 const copiesBefore=h.files.filter(f=>f.op==='copy').length;
 await h.boot();
 assert.equal(h.files.filter(f=>f.op==='copy').length,copiesBefore,'no second copy on reopen');
 assert.equal(h.one('SELECT COUNT(*) AS n FROM lost_attachments').n,2,'losses recorded once');
 assert.deepEqual(plain(['cashbook','expenses','bills','stock_items','users','staff_records'].map(t=>h.all(`SELECT * FROM ${t} ORDER BY id`))),snapshot,'reopen changes nothing');
 // Belt and braces: the table is declared in the migration AND the base schema.
 const dbSrc=read(dbPath);
 assert.ok(/if \(version < 39\)[\s\S]*CREATE TABLE IF NOT EXISTS lost_attachments/.test(dbSrc));
 assert.ok(dbSrc.indexOf('CREATE TABLE IF NOT EXISTS lost_attachments')<dbSrc.indexOf('async function runMigrations'));
 // Paths are never logged: they can carry a customer's name or number.
 assert.ok(!/console\.(log|warn|error)/.test(read('src/services/database/attachmentRepair.ts')),'the repair logs nothing');
},38));

check(105,'tapping an attachment resolves to the right action: images preview in-app, other files go to the phone, a missing file is a message not a crash — and every book uses the one opener',at('src/utils/openAttachment.ts','resolveAttachment'),()=>isolated(async h=>{
 const o=h.load('src/utils/openAttachment.ts');
 const kept='test://staff_docs/staff_1_2_ab.jpg';h.present.add(kept);
 const pdf='test://staff_docs/contract.pdf';h.present.add(pdf);
 const noExt='file:///data/user/0/com.app/cache/ImagePicker/12345';h.present.add(noExt);
 assert.deepEqual(plain(await o.resolveAttachment(kept)),{kind:'image',uri:kept},'a stored photo previews in-app');
 assert.deepEqual(plain(await o.resolveAttachment(noExt)),{kind:'image',uri:noExt},'a picker file with no extension is still an image');
 assert.deepEqual(plain(await o.resolveAttachment(pdf)),{kind:'external',uri:pdf},'a PDF goes to the phone');
 // Missing or unreadable: a message, never a crash.
 assert.deepEqual(plain(await o.resolveAttachment('test://staff_docs/gone.jpg')),{kind:'missing'},'a vanished file is reported');
 for(const bad of [null,undefined,'','   ','doc_1726000000000.pdf'])
  assert.deepEqual(plain(await o.resolveAttachment(bad)),{kind:'missing'},'bad input '+JSON.stringify(bad)+' is "missing", not a throw');
 // A web address cannot be checked on disk; let the viewer try it.
 assert.equal((await o.resolveAttachment('https://x.example/r.jpg')).kind,'image');
 assert.equal((await o.resolveAttachment('https://x.example/r.pdf')).kind,'external');
 for(const [p,img] of [['a.JPG',true],['a.jpeg',true],['a.png',true],['a.webp',true],['a.heic',true],['a.pdf',false],['a.docx',false],['noextension',true]])
  assert.equal(o.isImagePath(p),img,p);
 // Every screen that shows an attachment opens it through the ONE shared opener.
 for(const f of ['src/screens/StaffBook/StaffDetail.tsx','src/screens/StaffBook/AddStaffModal.tsx','src/screens/CashBook/CashEntryDetailScreen.tsx',
                 'src/screens/CashBook/CashEntryModal.tsx','src/screens/BillBook/BillDetailScreen.tsx','src/screens/ExpenseBook/ExpenseDetail.tsx']){
  const s=read(f);
  assert.ok(/useAttachmentOpener\(\)/.test(s),f+' uses the shared opener');
  assert.ok(/onPress=\{\(\) => openAttachment\(/.test(s),f+' opens on tap');
  assert.ok(/\{attachmentViewer\}/.test(s),f+' renders the viewer');
 }
 assert.ok(!/viewerVisible/.test(read('src/screens/ExpenseBook/ExpenseDetail.tsx')),'Expense no longer keeps its own one-off viewer');
 const viewer=read('src/components/ui/AttachmentViewer.tsx');
 assert.equal((viewer.match(/#[0-9A-Fa-f]{3,6}\b/g)||[]).length,0,'tokens only');
 assert.ok(/Alert\.alert\(t\('attachmentMissingTitle'\)/.test(viewer)&&/Alert\.alert\(t\('attachmentNoAppTitle'\)/.test(viewer),'missing file and no-app both give a message');
 assert.ok(!/console\.(log|warn|error)/.test(read('src/utils/openAttachment.ts')+viewer),'paths are never logged');
}));

check(106,'staff entries drill-down (Cash): only the target\'s own rows, totals equal their rows, downward only, removed staff still viewable, read-only screens',at('src/services/database/entryScope.ts','assertCanViewEntriesOf'),()=>isolated(async h=>{
 seedPeople(h); // owner → staffA, staffB, subA, subB ; otherOwner → otherStaff
 const day='2026-09-10';
 const row=(id,userId,direction,amount,date=day)=>h.insert('cashbook',{id,userId,direction,amount_paisa:amount,date,isDeleted:0});
 row('a1','staffA','in',50000);row('a2','staffA','in',25000);row('a3','staffA','out',10000);
 row('a4','staffA','in',7000,'2026-09-11'); // another day — in the all-time balance, not the day book
 row('s1','subA','in',99000);               // a peer staff member — must NOT be merged in
 row('b1','staffB','out',33000);
 const cash=h.load('src/services/database/cashbookDb.ts');
 const sumOf=(user,dateCond='')=>{const r=h.one(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_paisa ELSE 0 END),0) AS i, COALESCE(SUM(CASE WHEN direction='out' THEN amount_paisa ELSE 0 END),0) AS o, COUNT(*) AS n FROM cashbook WHERE userId=? AND isDeleted=0 ${dateCond}`,user);return r;};

 // Admin drills into a staff member: exactly their rows, totals = the sum of those rows.
 const book=await cash.getDayBook('owner',day,{createdBy:'staffA'});
 assert.deepEqual(plain(book.entries.map(e=>e.id)).sort(),['a1','a2','a3'],'only staffA\'s rows for that day — no peer, no sibling');
 const want=sumOf('staffA',`AND date(date)=date('${day}')`);
 assert.equal(book.dayTotals.cashIn,want.i);assert.equal(book.dayTotals.cashOut,want.o);assert.equal(book.dayTotals.entryCount,want.n);
 const all=sumOf('staffA');
 assert.equal((await cash.getCashBalanceSummary('owner',{createdBy:'staffA'})).cashBalance,all.i-all.o,'all-time balance = their rows only');
 // The owner's own Cash Book is OWN-ONLY: none of the team's rows are in it.
 assert.equal((await cash.getDayBook('owner',day)).entries.length,0,'owner\'s book holds no staff rows');

 // Same figures at one page and at twenty.
 const p1=await cash.getFilteredCashHistory('owner',{createdBy:'staffA'},1);
 const p20=await cash.getFilteredCashHistory('owner',{createdBy:'staffA'},20);
 assert.deepEqual(plain(p1.cashSummary),plain(p20.cashSummary),'totals identical at 1 and 20 rows');
 assert.equal(p1.entries.length,1);assert.ok(p20.entries.every(e=>e.userId==='staffA'));
 assert.deepEqual(plain((await cash.getCashHistoryDayTotals('owner',{createdBy:'staffA'})).map(d=>d.day)),['2026-09-11',day]);

 // Downward only, and the tree is two levels: an admin reaches their own staff and nobody
 // else. A staff member has nobody below them, so every drill-down they attempt is refused.
 assert.equal((await cash.getDayBook('owner',day,{createdBy:'subA'})).entries.length,1,'admin → their own staff');
 // Sideways and upward are REFUSED by the data layer — an error, not an empty answer.
 for(const [viewer,target,why] of [['staffA','subA','a peer staff member'],['staffA','staffB','sibling'],['subA','staffA','another peer'],
                                   ['staffA','owner','upward'],['staffA','subB','another peer'],['otherOwner','staffA','another business'],['staffA','staffA','self']]){
  await assert.rejects(cash.getDayBook(viewer,day,{createdBy:target}),/own team/,why+' must be refused');
  await assert.rejects(cash.getCashBalanceSummary(viewer,{createdBy:target}),/own team/,why+' (balance)');
  await assert.rejects(cash.getFilteredCashHistory(viewer,{createdBy:target}),/own team/,why+' (history)');
 }

 // A removed staff member's history stays viewable.
 await users(h).deactivateUser('staffA');
 assert.equal((await cash.getDayBook('owner',day,{createdBy:'staffA'})).entries.length,3,'removed staff still viewable');
 assert.equal((await cash.getCashBalanceSummary('owner',{createdBy:'staffA'})).cashBalance,all.i-all.o);

 // Read-only: no write action is reachable from a drill-down.
 const cb=read('src/screens/CashBook/CashBookScreen.tsx'),det=read('src/screens/CashBook/CashEntryDetailScreen.tsx'),hist=read('src/screens/CashBook/CashHistory.tsx');
 assert.ok(/\{!isKeyboardVisible && !viewAs && \(/.test(cb),'no Cash in / Cash out');
 assert.ok(/navigate\('CashEntryDetail', \{ entry: item, readOnly: !!viewAs \}\)/.test(cb),'entries open read-only');
 assert.ok(/\{viewAs\s*\?\s*<ReadOnlyBanner/.test(cb),'the book switcher is replaced by the read-only banner');
 assert.ok(/getDayBook\(user\.id, viewDate, viewAs \? \{ createdBy: viewAs\.userId \} : \{\}\)/.test(cb),'scoped by the VIEWER, selected by the target');
 assert.ok(/setViewAsBalance\(/.test(cb),'drill-down balance kept out of the shared store');
 assert.ok(/\{!readOnly && \(\s*<TouchableOpacity style=\{styles\.editBtn\}/.test(det),'no Edit');
 assert.ok(/\{!readOnly && \(\s*<View style=\{\[styles\.bottomContainer/.test(det),'no Delete');
 assert.ok(/\{!readOnly && \(\s*<TouchableOpacity onPress=\{\(\) => handleDelete/.test(hist),'no per-row delete in history');
 assert.ok(/createdBy: viewAs\.userId/.test(hist),'history is scoped to the person');
 // Wiring: Entries below Salary on the profile, route registered where the profile lives.
 assert.ok(/navigate\('StaffEntries', \{ staff \}\)/.test(read('src/screens/StaffBook/StaffDetail.tsx')));
 for(const nav of ['src/navigation/AdminNavigator.tsx'])assert.ok(/name="StaffEntries" component=\{StaffEntriesScreen\}/.test(read(nav)),nav);
 assert.equal((read('src/screens/StaffBook/StaffEntriesScreen.tsx').match(/#[0-9A-Fa-f]{3,6}\b/g)||[]).length,0,'tokens only');
}));

check(107,'Cash is OWN-ONLY for every pair of accounts: book, totals, day, balance, cash-flow report, PDF and CSV never show another person\'s entry; edits and deletes are owner-only',at('src/services/database/cashbookDb.ts','cashOwner'),()=>isolated(async h=>{
 seedPeople(h);
 const PEOPLE=['owner','staffA','subA','staffB','subB','otherOwner','otherStaff'];
 const day='2026-09-10';const made={};
 // Every entry is written through the real create path, by the logged-in person.
 for(const [i,who] of PEOPLE.entries()){
  h.login(who);made[who]=[];
  for(const [k,[dir,amt]] of [['in',10000+i],['out',300+i],['in',55+i]].entries()){
   made[who].push(await cash(h).createCashEntry(who,'ROW_'+who+'_d'+k,amt,dir,day));
  }
 }
 const own=who=>{const r=h.one("SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_paisa END),0) AS i, COALESCE(SUM(CASE WHEN direction='out' THEN amount_paisa END),0) AS o, COUNT(*) AS n FROM cashbook WHERE userId=? AND isDeleted=0 AND COALESCE(is_deleted,0)=0",who);return r;};
 const {getCashFlowSummary}=h.load('src/services/database/reports/cashFlowReportDb.ts');
 const failures=[];
 for(const viewer of PEOPLE){
  const mine=sorted(made[viewer].map(e=>e.description)),o=own(viewer);
  const hist=await cash(h).getFilteredCashHistory(viewer,{});
  const dayBook=await cash(h).getDayBook(viewer,day);
  const list=await cash(h).getCashEntriesByUserId(viewer,500,0);
  const bal=await cash(h).getCashBalanceSummary(viewer);
  const flow=await getCashFlowSummary(viewer,{startDate:day,endDate:day});
  const pdfHtml=await exportFile(h,'cash',viewer,{startDate:day,endDate:day});
  const csv=await exportFile(h,'cash',viewer,{startDate:day,endDate:day},'csv');
  for(const [what,text] of [['history',hist.entries.map(e=>e.description).join(' ')],['day',dayBook.entries.map(e=>e.description).join(' ')],
                            ['list',list.map(e=>e.description).join(' ')],['pdf',pdfHtml],['csv',csv]])
   if(JSON.stringify(tagsIn(text))!==JSON.stringify(mine))failures.push(viewer+' '+what+': '+tagsIn(text).join(',')+' — expected only '+mine.join(','));
  // Each account's totals equal the sum of its own rows, on every surface.
  for(const [what,i,out] of [['history',hist.cashSummary.cashIn,hist.cashSummary.cashOut],['day',dayBook.dayTotals.cashIn,dayBook.dayTotals.cashOut],
                             ['balance',bal.cashIn,bal.cashOut],['cash-flow report',flow.cashIn,flow.cashOut]])
   if(i!==o.i||out!==o.o)failures.push(viewer+' '+what+' totals '+i+'/'+out+' vs own '+o.i+'/'+o.o);
  if(dayBook.dayTotals.entryCount!==o.n)failures.push(viewer+' day count');
  if(bal.cashBalance!==o.i-o.o||flow.closingCash!==o.i-o.o)failures.push(viewer+' balance/closing');
 }
 assert.equal(failures.length,0,failures.join('\n'));

 // Edits and deletes are the author's alone — a parent cannot change a staff entry,
 // a staff member cannot change the admin's, and nobody touches another business.
 const target=made.staffA[0];
 const snapshot=()=>plain(h.one('SELECT * FROM cashbook WHERE id=?',target.id));
 const before=snapshot(),queued=h.one('SELECT COUNT(*) AS n FROM sync_queue').n;
 for(const actor of ['owner','subA','staffB','otherOwner']){
  h.login(actor);
  await assert.rejects(cash(h).updateCashEntry(target.id,actor,{description:'hijacked'}),/only change your own entries/,actor+' edit');
  await assert.rejects(cash(h).deleteCashEntry(target.id,actor),/only change your own entries/,actor+' delete');
 }
 assert.deepEqual(snapshot(),before,'a refused write changed the row');
 assert.equal(h.one('SELECT COUNT(*) AS n FROM sync_queue').n,queued,'a refused write was queued for sync');
 h.login('owner');
 await assert.rejects(cash(h).updateCashEntry('no_such_id','owner',{description:'x'}),/not found/);
 // The author still can.
 h.login('staffA');
 await cash(h).updateCashEntry(target.id,'staffA',{description:'ROW_staffA_d9'});
 assert.equal(h.one('SELECT description FROM cashbook WHERE id=?',target.id).description,'ROW_staffA_d9');
 await cash(h).deleteCashEntry(target.id,'staffA');
 assert.ok(h.one('SELECT id FROM cashbook WHERE id=?',target.id),'soft delete — the row is kept');
 assert.ok(!(await cash(h).getDayBook('staffA',day)).entries.some(e=>e.id===target.id));
 assert.ok(!(await cash(h).getDayBook('owner',day,{createdBy:'staffA'})).entries.some(e=>e.id===target.id),'gone from the drill-down too');

 // Source: no team scope left anywhere in the Cash data layer, and the seed ships no demo people.
 const src=read('src/services/database/cashbookDb.ts');
 assert.ok(!/userScope|parentId/.test(src),'cashbookDb must not scope by the team');
 assert.ok(!/parentId|buildReportQuery/.test(read('src/services/database/reports/cashFlowReportDb.ts')));
 const seed=read('src/services/database/seedData.ts');
 assert.ok(!/createTransaction|createCashEntry|'staff'|'substaff'/.test(seed),'seed creates only the admin');
}));

check(108,'cash entry details show category and note (empty ones hidden); Bill Details no longer offers Create new bill, which stays on the Bill Book',at('src/screens/CashBook/CashEntryDetailScreen.tsx','fieldList'),()=>isolated(async h=>{
 seedPeople(h);
 // Round trip: what the form saves is exactly what the book hands to the details screen.
 const full=await cash(h).createCashEntry('owner','With both',123456,'in','2026-09-10',null,'Sales','Invoice 42 — Ali');
 const bare=await cash(h).createCashEntry('owner','With neither',500,'out','2026-09-10');
 const day=await cash(h).getDayBook('owner','2026-09-10');
 const hist=await cash(h).getFilteredCashHistory('owner',{});
 for(const rows of [day.entries,hist.entries]){
  const a=rows.find(e=>e.id===full.id),b=rows.find(e=>e.id===bare.id);
  assert.equal(a.category,'Sales');assert.equal(a.note,'Invoice 42 — Ali');
  assert.equal(b.category,null);assert.equal(b.note,null);
 }
 // An edit round-trips too.
 await cash(h).updateCashEntry(full.id,'owner',{category:'Rent',note:'Changed'});
 const edited=(await cash(h).getDayBook('owner','2026-09-10')).entries.find(e=>e.id===full.id);
 assert.equal(edited.category,'Rent');assert.equal(edited.note,'Changed');
 // Both callers hand the whole row (SELECT *) to the details screen.
 assert.ok(/SELECT \* FROM cashbook WHERE \$\{where\} ORDER BY createdAt DESC/.test(read('src/services/database/cashbookDb.ts')));
 for(const f of ['src/screens/CashBook/CashBookScreen.tsx','src/screens/CashBook/CashHistory.tsx'])
  assert.ok(/navigate\('CashEntryDetail', \{ entry: item/.test(read(f)),f);
 // The screen renders each field only when it has a value — no blank label.
 const det=read('src/screens/CashBook/CashEntryDetailScreen.tsx');
 assert.ok(/const category = entry\.category\?\.trim\(\) \|\| '';/.test(det)&&/const note = entry\.note\?\.trim\(\) \|\| '';/.test(det),'whitespace-only counts as empty');
 assert.ok(/\{!!category && \(\s*<View style=\{styles\.fieldRow\}>\s*<Text style=\{styles\.fieldLabel\}>\{t\('commonCategory'\)\}<\/Text>\s*<Text style=\{styles\.fieldValue\}>\{categoryLabel\(t, category\)\}<\/Text>/.test(det),'category row');
 assert.ok(/\{!!note && \(\s*<View style=\{\[styles\.fieldRow[^\]]*\]\}>\s*<Text style=\{styles\.fieldLabel\}>\{t\(.commonNote.\)\}<\/Text>\s*<Text style=\{styles\.fieldValue\}>\{note\}<\/Text>/.test(det),'note row');
 assert.ok(/\{\(!!category \|\| !!note\) && \(/.test(det),'no empty box when both are blank');
 assert.equal((det.match(/#[0-9A-Fa-f]{3,6}\b/g)||[]).length,0,'tokens only');
 // Removal: Bill Details keeps Edit and Done but no longer creates bills; the Bill Book still does.
 const detail=read('src/screens/BillBook/BillDetailScreen.tsx');
 assert.ok(!/Create new bill/.test(detail),'button removed');
 assert.equal((detail.match(/navigate\('CreateNewBillModal'/g)||[]).length,1,'only the Edit path remains');
 assert.ok(/navigate\('CreateNewBillModal', \{ billId: bill\.id \}\)/.test(detail));
 assert.ok(read('src/screens/BillBook/BillBookScreen.tsx').includes("navigation.navigate('CreateNewBillModal')"),'create still reachable from the Bill Book');
 // Suppliers "+ Add" is deliberately KEPT: it is the only way to add a second supplier.
 // The Suppliers header Add button is kept (owner's decision); pinned by what it does, not its glyphs.
 assert.ok(/style=\{styles\.addHeaderBtn\} onPress=\{\(\) => navigation\.navigate\('AddSupplierModal'\)\}/.test(read('src/screens/StockBook/SuppliersScreen.tsx')),'Suppliers header Add button still opens the add form');
 assert.ok(read('src/screens/StockBook/SuppliersScreen.tsx').includes("<Text style={styles.addHeaderText}>Add</Text>"));
}));

check(109,'editing a bill updates it IN PLACE: bill count unchanged, same id and number, lines updated not duplicated, stock moves by the difference only, returns protected, author-only, all-or-nothing',at('src/services/database/billDb.ts','saveBillEdit'),()=>isolated(async h=>{
 seedPeople(h);h.login('staffA');
 const bills=h.load('src/services/database/billDb.ts'),stock=h.load('src/services/database/stockDb.ts');
 h.insert('stock_items',{id:'s1',user_id:'staffA',name_en:'Rice',purchase_price:5000,sale_price:10000,quantity:100});
 h.insert('stock_items',{id:'s2',user_id:'staffA',name_en:'Sugar',purchase_price:2000,sale_price:3000,quantity:50});
 const qty=id=>h.one('SELECT quantity FROM stock_items WHERE id=?',id).quantity;
 // Created exactly as the form creates it: the bill, then one sale movement per stock line.
 const lines=[{item_id:'s1',item_name:'Rice',quantity:3,unit_price:10000,line_total:30000},
              {item_id:'s2',item_name:'Sugar',quantity:2,unit_price:3000,line_total:6000},
              {item_id:null,item_name:'Delivery',quantity:1,unit_price:1500,line_total:1500}];
 const bill=await bills.createBill({user_id:'staffA',customer_id:'walk_in',party_name:'Ali',bill_date:'2026-09-10',subtotal:37500,discount_pct:0,discount_amount:0,tax_amount:0,total:37500,paid:0,due:37500,status:'unpaid',payment_method:'cash',is_draft:0,is_hold:0},lines);
 await stock.addStockMovement({item_id:'s1',change:-3,reason:'sale',date:'2026-09-10',user_id:'staffA'});
 await stock.addStockMovement({item_id:'s2',change:-2,reason:'sale',date:'2026-09-10',user_id:'staffA'});
 assert.equal(qty('s1'),97);assert.equal(qty('s2'),48);
 const count=()=>h.one('SELECT COUNT(*) AS n FROM bills').n,itemRows=()=>h.one('SELECT COUNT(*) AS n FROM bill_items').n;
 const billsBefore=count();
 const orig=plain(h.all('SELECT * FROM bill_items WHERE bill_id=? ORDER BY rowid',bill.id));
 const [rice,sugar,delivery]=orig;
 const summary=async()=>(await bills.getFilteredBills('staffA',{status:'all'})).billSummary;

 // THE EDIT: Rice 3 → 5, Sugar removed, Delivery re-priced, a new custom line, new party.
 await bills.saveBillEdit(bill.id,'staffA',{customer_id:'walk_in',party_name:'Ali Traders',bill_date:'2026-09-11',notes:'edited',
  lines:[{billItemId:rice.id,item_id:'s1',item_name:'Rice',quantity:5,unit_price:10000},
         {billItemId:delivery.id,item_id:null,item_name:'Delivery',quantity:1,unit_price:2000},
         {item_id:null,item_name:'Packing',quantity:2,unit_price:250}]});
 // 1. No new bill: same count, same id, same number, values changed in place.
 assert.equal(count(),billsBefore,'editing must not create a bill');
 const row=h.one('SELECT * FROM bills WHERE id=?',bill.id);
 assert.equal(row.bill_no,bill.bill_no,'bill number kept');
 assert.equal(row.party_name,'Ali Traders');assert.equal(row.bill_date,'2026-09-11');assert.equal(row.notes,'edited');
 const expected=5*10000+2000+2*250;
 assert.equal(row.subtotal,expected);assert.equal(row.total,expected);
 // Nothing had been received, so the edited bill still owes the whole total.
 assert.equal(row.paid,0);assert.equal(row.due,expected);assert.equal(row.status,'unpaid');
 assert.ok(Number.isInteger(row.total),'paisa stays integer');
 // 2. Lines: kept lines updated IN PLACE (same ids), removed line soft-deleted, one new line.
 const live=plain(h.all('SELECT * FROM bill_items WHERE bill_id=? AND is_deleted=0 ORDER BY rowid',bill.id));
 assert.deepEqual(live.map(l=>l.item_name),['Rice','Delivery','Packing']);
 assert.equal(live[0].id,rice.id);assert.equal(live[0].quantity,5);assert.equal(live[0].line_total,50000);
 assert.equal(live[1].id,delivery.id);assert.equal(live[1].unit_price,2000);
 assert.equal(itemRows(),4,'3 original rows + 1 new — nothing duplicated');
 const gone=h.one('SELECT * FROM bill_items WHERE id=?',sugar.id);
 assert.ok(gone,'removed line is kept');assert.equal(gone.is_deleted,1,'…soft-deleted');
 // 3. Stock: only the difference. Rice sold 2 more; Sugar's 2 come back. Never re-deducted.
 assert.equal(qty('s1'),95);assert.equal(qty('s2'),50);
 const adj=plain(h.all("SELECT item_id, change, reason FROM stock_movements WHERE reason='adjustment' ORDER BY item_id"));
 assert.deepEqual(adj,[{item_id:'s1',change:-2,reason:'adjustment'},{item_id:'s2',change:2,reason:'adjustment'}]);
 // 4. The Bill Book's SQL totals count the bill once, at its new value.
 let s1=await summary();assert.equal(s1.billCount,1);assert.equal(only(s1.totalBilled),expected);assert.equal(only(s1.totalDue),expected,'nothing received, so the whole total is still due');
 // Saving the same thing again changes nothing and moves no stock.
 const same=live.map(l=>({billItemId:l.id,item_id:l.item_id,item_name:l.item_name,quantity:l.quantity,unit_price:l.unit_price}));
 await bills.saveBillEdit(bill.id,'staffA',{customer_id:'walk_in',party_name:'Ali Traders',bill_date:'2026-09-11',notes:'edited',lines:same});
 assert.equal(qty('s1'),95);assert.equal(itemRows(),4);assert.equal(count(),billsBefore);

 // 5. Returns are protected, and a refused edit changes NOTHING (one transaction).
 h.sqlite.prepare('UPDATE bill_items SET returned_quantity=2 WHERE id=?').run(rice.id);
 const snap=()=>JSON.stringify([plain(h.all('SELECT * FROM bills ORDER BY id')),plain(h.all('SELECT * FROM bill_items ORDER BY id')),plain(h.all('SELECT id,quantity FROM stock_items ORDER BY id')),h.one('SELECT COUNT(*) AS n FROM stock_movements').n,h.one('SELECT COUNT(*) AS n FROM sync_queue').n]);
 const frozen=snap();
 await assert.rejects(bills.saveBillEdit(bill.id,'staffA',{customer_id:'walk_in',party_name:'X',bill_date:'2026-09-11',
  lines:[{billItemId:rice.id,item_id:'s1',item_name:'Rice',quantity:1,unit_price:10000},same[2]]}),/already returned/);
 // ^ Delivery is dropped, so its soft delete is WRITTEN before Rice is refused — the snapshot below proves it rolled back.
 await assert.rejects(bills.saveBillEdit(bill.id,'staffA',{customer_id:'walk_in',party_name:'X',bill_date:'2026-09-11',
  lines:same.slice(1)}),/returned items and cannot be removed/);
 // A later failure (unknown line) must roll back the writes made before it.
 await assert.rejects(bills.saveBillEdit(bill.id,'staffA',{customer_id:'walk_in',party_name:'X',bill_date:'2026-09-11',
  lines:[...same,{billItemId:'not_a_line',item_id:null,item_name:'Ghost',quantity:1,unit_price:1}]}),/line not found/);
 for(const bad of [{lines:[]},{lines:[{item_id:null,item_name:'Z',quantity:0,unit_price:5}]},{lines:[{item_id:null,item_name:'Z',quantity:1,unit_price:12.5}]},{bill_date:'2026-99-99'}])
  await assert.rejects(bills.saveBillEdit(bill.id,'staffA',{customer_id:'walk_in',party_name:'X',bill_date:'2026-09-11',lines:same,...bad}));
 assert.equal(snap(),frozen,'a refused edit must leave the bill, its lines, stock and the sync queue untouched');

 // 6. Author-only: a parent, a grand-parent, a sibling and another business are all refused.
 for(const actor of ['owner','subA','staffB','otherOwner']){
  h.login(actor);
  await assert.rejects(bills.saveBillEdit(bill.id,actor,{customer_id:'walk_in',party_name:'Hijack',bill_date:'2026-09-11',lines:same}),/only change your own bills/,actor);
  await assert.rejects(bills.updateBill(bill.id,actor,{party_name:'Hijack'}),/only change your own bills/,actor+' updateBill');
  await assert.rejects(bills.updateBillItem(rice.id,bill.id,actor,{quantity:9}),/only change your own bills/,actor+' updateBillItem');
  await assert.rejects(bills.deleteBill(bill.id,actor),/only change your own bills/,actor+' deleteBill');
 }
 assert.equal(snap(),frozen,'refused writes changed nothing');
 h.login('staffA');
 await assert.rejects(bills.updateBillItem(rice.id,'some_other_bill','staffA',{quantity:9}),/Bill not found|line not found/);

 // 7. A part-paid bill keeps what was received, capped at a lower total.
 h.sqlite.prepare('UPDATE bills SET paid=10000, due=total-10000, status=? WHERE id=?').run('partial',bill.id);
 await bills.saveBillEdit(bill.id,'staffA',{customer_id:'walk_in',party_name:'Ali Traders',bill_date:'2026-09-11',lines:same});
 let r=h.one('SELECT * FROM bills WHERE id=?',bill.id);assert.equal(r.paid,10000);assert.equal(r.due,expected-10000);assert.equal(r.status,'partial');
 await bills.saveBillEdit(bill.id,'staffA',{customer_id:'walk_in',party_name:'Ali Traders',bill_date:'2026-09-11',
  lines:[same[0],{...same[1],unit_price:0},{...same[2],quantity:1,unit_price:0}].map((l,i)=>i===0?{...l,quantity:2}:l)});
 r=h.one('SELECT * FROM bills WHERE id=?',bill.id);assert.equal(r.total,20000);assert.equal(r.paid,10000);assert.equal(r.due,10000);
 await bills.saveBillEdit(bill.id,'staffA',{customer_id:'walk_in',party_name:'Ali Traders',bill_date:'2026-09-11',lines:same});
 r=h.one('SELECT * FROM bills WHERE id=?',bill.id);assert.equal(r.paid,10000,'what was received stays');assert.equal(r.due,r.total-10000);assert.equal(r.status,'partial');

 // 8. A typed-amount bill (no lines) edits its amount and touches no stock.
 const manual=await bills.createBill({user_id:'staffA',customer_id:'walk_in',party_name:'Cash sale',bill_date:'2026-09-10',subtotal:5000,discount_pct:0,discount_amount:0,tax_amount:0,total:5000,paid:5000,due:0,status:'paid',payment_method:'cash',is_draft:0,is_hold:0},[]);
 const moves=h.one('SELECT COUNT(*) AS n FROM stock_movements').n,n0=count();
 await bills.saveBillEdit(manual.id,'staffA',{customer_id:'walk_in',party_name:'Cash sale',bill_date:'2026-09-10',manualTotal:7500,lines:[]});
 r=h.one('SELECT * FROM bills WHERE id=?',manual.id);assert.equal(r.total,7500);
 // Rs 5,000 was received before the edit: it stays, and the rest is now due.
 assert.equal(r.paid,5000);assert.equal(r.due,2500);assert.equal(r.status,'partial');assert.equal(r.bill_no,manual.bill_no);
 assert.equal(count(),n0);assert.equal(h.one('SELECT COUNT(*) AS n FROM stock_movements').n,moves);
 s1=await summary();assert.equal(s1.billCount,2,'still exactly two bills');

 // 9. Wiring: Edit loads THAT bill and saves through the in-place path; stock is not re-deducted by the form.
 const form=read('src/screens/BillBook/CreateNewBillModal.tsx');
 assert.ok(/const editBillId: string \| undefined = route\?\.params\?\.billId;/.test(form),'the form reads the bill id');
 assert.ok(/getBillForEdit\(editBillId\)/.test(form),'the bill is loaded fresh');
 const editBranch=form.slice(form.indexOf('if (isEdit && editBillId) {'),form.indexOf('const newBill = {'));
 assert.ok(/await editBill\(editBillId, user\.id, \{/.test(editBranch)&&/return;/.test(editBranch),'edit saves in place and stops');
 assert.ok(!/addBill\(|addStockMovement\(/.test(editBranch),'the edit branch never creates a bill or re-deducts stock');
 assert.ok(/billItemId: i\.billItemId/.test(editBranch),'lines keep their row ids');
 assert.ok(/value=\{cart\.length > 0 \? paisaToRupeesString\(calculatedTotal\) : manualAmount\}/.test(form),'the amount field shows rupees, not paisa');
 assert.ok(/\{bill\.user_id === user\?\.id \? \(/.test(read('src/screens/BillBook/BillDetailScreen.tsx')),'Edit is offered only on your own bill');
 assert.equal((form.match(/#[0-9A-Fa-f]{3,6}\b/g)||[]).length,0,'tokens only');
}));

check(110,'bug sweep: CSV cells escaped (RFC 4180 + formula guard); local-day defaults; PDFs escape user text and share one token print design; bill invoice totals add up; returns are atomic and reachable; expense and staff Edit are real and permission-checked',at('src/components/Download/csvGenerator.ts','csvCell'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 // ── 1. CSV: every cell escaped by the writer itself ─────────────────────────
 const {csvCell}=h.load('src/components/Download/csvGenerator.ts');
 assert.equal(csvCell('plain'),'plain');
 assert.equal(csvCell('a, b'),'"a, b"');
 assert.equal(csvCell('5" pipe'),'"5"" pipe"');
 assert.equal(csvCell('line1\nline2'),'"line1\nline2"');
 assert.equal(csvCell('=SUM(A1:A9)'),"'=SUM(A1:A9)");
 assert.equal(csvCell('+923001234567'),"'+923001234567");
 assert.equal(csvCell('-1250.50'),'-1250.50','a negative amount is left alone');
 assert.equal(csvCell(null),'');
 // A real export: a description full of separators stays ONE cell.
 const nasty='He said "hi", then\nleft';
 await cash(h).createCashEntry('owner',nasty,123456,'in','2026-09-10',null,'Sales, misc','n');
 const before=h.csv.length;
 await h.load('src/components/Download/pdfGenerator.ts').generateReportFile({reportType:'cash',userId:'owner',format:'csv',startDate:'2026-09-01',endDate:'2026-09-30'});
 const csvText=h.csv.at(-1);assert.equal(h.csv.length,before+1);
 const parse=t=>{const rows=[];let row=[],cell='',q=false;for(let i=0;i<t.length;i++){const c=t[i];
  if(q){if(c==='"'){if(t[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=c;}
  else if(c==='"')q=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}
  row.push(cell);rows.push(row);return rows;};
 const table=parse(csvText);
 assert.deepEqual(plain(table[0]),['Date','Type','Description','Category','Amount']);
 assert.equal(table.length,2,'one header + one row, however many separators the text holds');
 assert.equal(table[1].length,5,'columns never shift');
 assert.equal(table[1][2],nasty);assert.equal(table[1][3],'Sales, misc');assert.equal(table[1][1],'In');assert.equal(table[1][4],'1234.56');
 const gen=read('src/components/Download/pdfGenerator.ts');
 assert.ok(!/`"\$\{/.test(gen),'callers pass raw values; the writer quotes');

 // ── 2. Defaults are the LOCAL day, never the UTC one ─────────────────────────
 const today=h.load('src/utils/dates.ts').todayDate();
 const c=await cash(h).createCashEntry('owner','no date',100,'in');assert.equal(c.date,today);
 const k=await khata(h).createTransaction('owner','No date',100,'lena','');assert.equal(h.one('SELECT date FROM transactions WHERE id=?',k.id).date,today);
 for(const f of ['cashbookDb','transactionDb','purchaseDb','attendanceDb'])
  assert.ok(!/split\('T'\)\[0\]/.test(read('src/services/database/'+f+'.ts')),f+' derives a day from UTC');

 // ── 3. Print design: one token-built stylesheet, user text escaped everywhere ─
 const style=read('src/components/Download/printStyle.ts'),tpl=read('src/components/Download/reportTemplates.ts'),kh=read('src/utils/pdfGenerator.ts'),bd=read('src/screens/BillBook/BillDetailScreen.tsx');
 for(const [n,src] of [['printStyle',style],['reportTemplates',tpl],['utils/pdfGenerator',kh],['BillDetailScreen',bd]])
  assert.equal((src.match(/#[0-9A-Fa-f]{3,8}\b/g)||[]).length,0,n+' has a hardcoded colour');
 assert.ok(/PRINT_STYLE/.test(tpl)&&/PRINT_STYLE/.test(kh)&&/PRINT_STYLE/.test(bd),'every document shares the print design');
 assert.ok(!/font-weight:\s*(bold|[6-9]00)/.test(style+tpl+kh+bd),'two weights only');
 const {esc}=h.load('src/components/Download/printStyle.ts');
 assert.equal(esc(`A&B <b>"x"</b> 'y'`),'A&amp;B &lt;b&gt;&quot;x&quot;&lt;/b&gt; &#39;y&#39;');
 await cash(h).createCashEntry('owner','<script>x</script> & co',500,'out','2026-09-11');
 const pdfHtml=await report(h,'cash','owner');
 assert.ok(!pdfHtml.includes('<script>'),'user text never becomes markup');assert.ok(pdfHtml.includes('&lt;script&gt;x&lt;/script&gt; &amp; co'));
 assert.ok(!/>(IN|OUT|UNPAID|PAID|ACTIVE)</.test(pdfHtml),'sentence case in documents');
 // The Khata export and the bill invoice escape every user-typed field too.
 for(const field of ['t.partyName','t.notes'])assert.ok(new RegExp('esc\\('+field.replace('.','\\.')).test(kh),'Khata PDF escapes '+field);
 for(const field of ['bill.party_name','item.item_name','bill.notes','user?.businessName'])assert.ok(bd.includes('esc('+field),'invoice escapes '+field);
 // Bill invoice: subtotal → discount → tax → total → received → balance due; no mislabelled "Net amount".
 assert.ok(!/Net amount|Net Amount/.test(bd),'"Net amount" printed the due figure');
 for(const label of ['Subtotal: <strong>','Discount: <strong>','Tax: <strong>','Total: <strong>','Received: <strong>','Balance due: <strong>'])assert.ok(bd.includes(label),'invoice shows '+label);
 assert.ok(/generateTransactionPDF\(all, [^\n]*, totals\)/.test(read('src/screens/staff/KhataScreen.tsx')),'Khata PDF totals are the SQL summary');

 // ── 4. Returns: atomic, author-only, stock restored, reachable ───────────────
 h.login('staffA');
 const billDb=h.load('src/services/database/billDb.ts');
 h.insert('stock_items',{id:'r1',user_id:'staffA',name_en:'Rice',purchase_price:5000,sale_price:10000,quantity:10});
 const b=await billDb.createBill({user_id:'staffA',customer_id:'walk_in',party_name:'Ali',bill_date:'2026-09-10',subtotal:31500,discount_pct:0,discount_amount:0,tax_amount:0,total:31500,paid:0,due:31500,status:'unpaid',payment_method:'cash',is_draft:0,is_hold:0},
  [{item_id:'r1',item_name:'Rice',quantity:3,unit_price:10000,line_total:30000},{item_id:null,item_name:'Delivery',quantity:1,unit_price:1500,line_total:1500}]);
 const [riceLine,delLine]=plain(h.all('SELECT * FROM bill_items WHERE bill_id=? ORDER BY rowid',b.id));
 const snap=()=>JSON.stringify([plain(h.all('SELECT id,returned_quantity FROM bill_items ORDER BY id')),h.one('SELECT quantity FROM stock_items WHERE id=?','r1').quantity,h.one('SELECT COUNT(*) AS n FROM stock_movements').n]);
 const frozen=snap();
 // The second line is over-returned: the first must NOT be written either.
 await assert.rejects(billDb.returnBillItems(b.id,'staffA',[{billItemId:riceLine.id,qty:2},{billItemId:delLine.id,qty:5}]),/Cannot return more than 1/);
 assert.equal(snap(),frozen,'a refused return changes nothing — all or nothing');
 for(const actor of ['owner','subA','staffB']){h.login(actor);await assert.rejects(billDb.returnBillItems(b.id,actor,[{billItemId:riceLine.id,qty:1}]),/only change your own bills/,actor);}
 assert.equal(snap(),frozen);
 h.login('staffA');
 for(const bad of [[],[{billItemId:riceLine.id,qty:1.5}],[{billItemId:riceLine.id,qty:-1}],[{billItemId:riceLine.id,qty:1},{billItemId:riceLine.id,qty:1}]])
  await assert.rejects(billDb.returnBillItems(b.id,'staffA',bad));
 await billDb.returnBillItems(b.id,'staffA',[{billItemId:riceLine.id,qty:2},{billItemId:delLine.id,qty:1}]);
 assert.equal(h.one('SELECT returned_quantity FROM bill_items WHERE id=?',riceLine.id).returned_quantity,2);
 assert.equal(h.one('SELECT returned_quantity FROM bill_items WHERE id=?',delLine.id).returned_quantity,1);
 assert.equal(h.one('SELECT quantity FROM stock_items WHERE id=?','r1').quantity,12,'stock comes back only for the stock line');
 await assert.rejects(billDb.returnBillItems(b.id,'staffA',[{billItemId:riceLine.id,qty:2}]),/Cannot return more than 1/,'the running returned total is respected');
 assert.ok(/navigate\('ReturnItemsModal', \{ billId: bill\.id \}\)/.test(bd),'returns reachable from Bill details');
 const rim=read('src/screens/BillBook/ReturnItemsModal.tsx');
 assert.ok(/returnItems\(bill\.id, user\.id, returns\)/.test(rim)&&!/addStockMovement|updateBillItemRecord/.test(rim),'the screen uses the single transaction');
 assert.equal((rim.match(/#[0-9A-Fa-f]{3,8}\b/g)||[]).length,0,'tokens only');

 // ── 5. Expense Edit: real, in place, author-only ─────────────────────────────
 const exp=h.load('src/services/database/expenseDb.ts');
 const e=await exp.addExpenseRecord({user_id:'staffA',amount:5000,description:'Fuel',expense_date:'2026-09-10'});
 const count=h.one('SELECT COUNT(*) AS n FROM expenses').n;
 await exp.updateExpenseRecord(e.id,'staffA',{amount:7550,description:'Fuel for van',category:'Transport',note:'',expense_date:'2026-09-11'});
 const er=h.one('SELECT * FROM expenses WHERE id=?',e.id);
 assert.equal(er.amount,7550);assert.equal(er.description,'Fuel for van');assert.equal(er.category,'Transport');assert.equal(er.note,null);assert.equal(er.expense_date,'2026-09-11');
 assert.equal(h.one('SELECT COUNT(*) AS n FROM expenses').n,count,'edited in place, not re-created');
 assert.equal((await exp.getExpenseById(e.id)).amount,7550);
 for(const actor of ['owner','subA','staffB'])await assert.rejects(exp.updateExpenseRecord(e.id,actor,{amount:1}),/only change your own expenses/,actor);
 await assert.rejects(exp.deleteExpenseRecord(e.id,'owner'),/only change your own expenses/);
 for(const bad of [{amount:0},{amount:12.5},{description:'  '},{expense_date:'2026-99-01'},{user_id:'owner'},{is_deleted:1}])
  await assert.rejects(exp.updateExpenseRecord(e.id,'staffA',bad),undefined,JSON.stringify(bad));
 assert.equal(h.one('SELECT amount FROM expenses WHERE id=?',e.id).amount,7550,'refused edits changed nothing');
 const ed=read('src/screens/ExpenseBook/ExpenseDetail.tsx'),ae=read('src/screens/ExpenseBook/AddExpenseModal.tsx');
 assert.ok(!/coming soon/i.test(ed)&&/navigate\('AddExpenseModal', \{ expense \}\)/.test(ed)&&/expense\.user_id === user\?\.id/.test(ed),'Edit is real and offered only to the author');
 assert.ok(/await updateExpense\(editing\.id, user\.id, \{/.test(ae),'the form saves in place when editing');

 // ── 6. Staff Edit: real, team-checked, name kept in sync with the login ──────
 const mgr=h.load('src/services/database/managedAccountDb.ts');
 h.insert('users',{id:'kid',name:'Kid',role:'staff',parentId:'staffA',account_level:'substaff',phone:'03009998877',businessName:'B',passwordHash:'x'});
 h.insert('staff_records',{id:'sr_kid',user_id:'staffA',linked_user_id:'kid',name_en:'Kid',phone:'03009998877',role:'Helper',status:'active',monthly_salary:0,joining_date:'2026-01-01'});
 h.login('staffA');
 await mgr.updateStaffProfile('sr_kid',{name_en:'Kid Khan',role:'Cashier',area:'Khuzdar',email:'kid@example.com',joining_date:'2026-02-01'});
 const sr=h.one('SELECT * FROM staff_records WHERE id=?','sr_kid');
 assert.equal(sr.name_en,'Kid Khan');assert.equal(sr.role,'Cashier');assert.equal(sr.area,'Khuzdar');assert.equal(sr.joining_date,'2026-02-01');
 assert.equal(h.one('SELECT name FROM users WHERE id=?','kid').name,'Kid Khan','the login shows the same name');
 assert.equal(sr.phone,'03009998877','the login phone is never changed by Edit');
 h.login('owner');await mgr.updateStaffProfile('sr_kid',{area:'Dubai'});assert.equal(h.one('SELECT area FROM staff_records WHERE id=?','sr_kid').area,'Dubai','admin → sub-staff of their staff');
 for(const actor of ['staffB','subA','kid','otherOwner']){h.login(actor);await assert.rejects(mgr.updateStaffProfile('sr_kid',{area:'X'}),undefined,actor+' must be refused');}
 h.login('staffA');
 for(const bad of [{phone:'03000000000'},{status:'inactive'},{monthly_salary:1},{name_en:'  '},{email:'nope'},{joining_date:'soon'}])
  await assert.rejects(mgr.updateStaffProfile('sr_kid',bad),undefined,JSON.stringify(bad));
 assert.equal(h.one('SELECT area FROM staff_records WHERE id=?','sr_kid').area,'Dubai','refused edits changed nothing');
 const sd=read('src/screens/StaffBook/StaffDetail.tsx');
 assert.ok(!/coming soon/i.test(sd)&&/updateStaffProfile\(staff\.id,[^;]*\bform\b/.test(sd),'Staff Edit is real');
 assert.ok(!/removeStaffAccess[\s\S]{0,40}ownerOf === actor\.id/.test(read('src/services/database/managedAccountDb.ts'))&&/managedRecordIn\(db, actor, staffRecordId, 'You can only remove/.test(read('src/services/database/managedAccountDb.ts')),'Remove and Edit share one team rule');

 // ── 7. Small screen fixes ─────────────────────────────────────────────────────
 assert.ok(!/toUpperCase\(\)/.test(read('src/screens/CashBook/CashBookScreen.tsx').match(/const formatDayTitle[\s\S]*?\n  \};/)[0]),'day header in sentence case');
 const cl=read('src/components/khata/CustomerBalanceList.tsx');
 assert.ok(!/\.filter\(/.test(cl),'the customer list filters a loaded array again'); assert.ok(/getPartyBalances\(userId, \{ search/.test(cl),'search is not passed to SQL');
}));

check(111,'batch 1: own password change needs the current one and the creation rule; login never logs the phone; WhatsApp gets an international number; a customer\'s totals are SQL; lena/dena mean the same on every screen',at('src/services/database/userDb.ts','changeOwnPassword'),()=>isolated(async h=>{
 const api=users(h);
 const u=await api.createUser('Pass Test','03135550000','FixturePass1','staff','staff','Shop');
 h.login(u.id);
 // ── Password change: current password required, same strength rule as creation ─
 await assert.rejects(api.changeOwnPassword(u.id,'WrongPass1','NewSecret9'),/Current password is incorrect/);
 for(const [weak,why] of [['short1A','8 characters'],['alllowercase1','uppercase'],['NoDigitsHere','number']])
  await assert.rejects(api.changeOwnPassword(u.id,'FixturePass1',weak),new RegExp(why));
 await assert.rejects(api.changeOwnPassword(u.id,'FixturePass1','FixturePass1'),/different/);
 assert.equal((await api.verifyUserLogin('03135550000','FixturePass1')).id,u.id,'refused changes kept the old password');
 await api.changeOwnPassword(u.id,'FixturePass1','NewSecret9');
 assert.equal(await api.verifyUserLogin('03135550000','FixturePass1'),null);
 assert.equal((await api.verifyUserLogin('03135550000','NewSecret9')).id,u.id);
 assert.equal(api.accountPasswordProblem,h.load('src/services/database/managedAccountDb.ts').accountPasswordProblem,'one strength rule for creation and change');
 const cp=read('src/screens/staff/ChangePasswordScreen.tsx');
 assert.ok(/changeOwnPassword\(user\.id, currentPassword, newPassword\)/.test(cp)&&!/length < 6/.test(cp),'the screen asks for the current password and uses the shared rule');

 // ── Login must never log the phone (or anything typed) ─────────────────────────
 h.logs.length=0;
 await api.verifyUserLogin('0313 5550000','NewSecret9');await api.verifyUserLogin('03139999999','nope');await api.verifyUserLogin('03135550000','bad');
 assert.ok(!h.logs.some(l=>/0313|5550000|9999999/.test(l)),'a phone number reached the log: '+h.logs.join(' | '));
 assert.ok(!/console\.(log|warn|error)\([^)]*phone/.test(read('src/services/database/userDb.ts')));

 // ── WhatsApp / SMS numbers in international form ────────────────────────────────
 // The PROPERTY: a number from ANY country, stored in any of the four shapes this
 // field accepts, comes back as that country's E.164 digits. Asserted as a table
 // rather than two magic cases — the old test pinned only PK and one UAE prefix,
 // which is exactly why every other country silently became a Pakistani number.
 const {internationalPhone,DEFAULT_COUNTRY_CODE}=h.load('src/utils/phone.ts');
 assert.equal(DEFAULT_COUNTRY_CODE,'92','this shop is Pakistan-first; the rule is not');
 const NUMBERS=[
  ['Pakistan mobile','92','3001234567'],  ['Pakistan landline','92','4235678901'],
  ['UAE','971','501234567'],              ['Saudi Arabia','966','501234567'],
  ['USA','1','5551234567'],               ['UK','44','7911123456'],
  ['China','86','13800138000'],           ['India','91','9812345678'],
  ['Turkey','90','5321234567'],
 ];
 for(const [where,cc,nat] of NUMBERS){
  const want=cc+nat;
  // Local shape: this country's own numbers keep the bare trunk 0; a foreign number
  // typed into the same field carries its country code behind that 0.
  const local=cc===DEFAULT_COUNTRY_CODE?'0'+nat:'0'+cc+nat;
  for(const stored of [local,`+${cc} ${nat}`,`00${cc}${nat}`,`${cc}${nat}`]){
   assert.equal(internationalPhone(stored),want,`${where}: ${stored} must dial ${want}`);
  }
 }
 // A foreign number must never acquire the default country code.
 for(const [where,cc,nat] of NUMBERS.filter(n=>n[1]!==DEFAULT_COUNTRY_CODE)){
  const got=internationalPhone('0'+cc+nat);
  assert.ok(!got.startsWith(DEFAULT_COUNTRY_CODE+cc),`${where} became a ${DEFAULT_COUNTRY_CODE} number: ${got}`);
 }
 // Nothing dialable.
 for(const junk of ['',null,undefined,'123','abc','0','+']) assert.equal(internationalPhone(junk),null,'not a number: '+String(junk));

 // ── A customer's totals are SQL over the same rows the ledger lists ──────────────
 seedPeople(h);h.login('owner');
 for(const [amt,type] of [[5000,'lena'],[2000,'dena'],[700,'lena']])await khata(h).createTransaction('owner','Ali Traders',amt,type,'','2026-09-10');
 await khata(h).createTransaction('owner','Someone else',99999,'lena','','2026-09-10');
 const s=await khata(h).getPartySummary('owner','Ali Traders');
 assert.deepEqual(plain(s),{totalLena:5700,totalDena:2000,netBalance:3700});
 const rows=await khata(h).getTransactionsByParty('owner','Ali Traders');
 assert.equal(rows.filter(r=>r.type==='lena').reduce((a,r)=>a+r.amount_paisa,0),s.totalLena,'summary equals the listed rows');
 const cd=read('src/screens/staff/CustomerDetailScreen.tsx');
 assert.ok(/getPartySummary\(userId, partyName, viewAs\?\.userId\)/.test(cd)&&!/transactions\.filter\([^)]*\)\.reduce/.test(cd),'the screen shows SQL totals');

 // ── Lena = credit given (money out, red); dena = payment taken (money in, green) ─
 const tone=(src,re)=>{const m=re.exec(src);assert.ok(m,'pattern '+re);return m[1];};
 const ti=read('src/components/TransactionItem.tsx');
 assert.ok(/tone=\{isLena \? 'out' : 'in'\}/.test(ti),'Khata row: lena red, dena green');
 const ks=read('src/screens/staff/KhataScreen.tsx');
 assert.equal(tone(ks,/paisa=\{shown\.totalLena\} tone="(\w+)"/),'out');assert.equal(tone(ks,/paisa=\{shown\.totalDena\} tone="(\w+)"/),'in');
 // The day total is `day` now, so `t` can be the translate function on this screen.
 assert.equal(tone(ks,/paisa=\{day\.lena\} tone="(\w+)"/),'out');assert.equal(tone(ks,/paisa=\{day\.dena\} tone="(\w+)"/),'in');
 assert.ok(/tone=\{isCredit \? 'out' : 'in'\}/.test(cd),'Customer ledger: credit given red, payment green');
 assert.ok(/const tone = t === 'lena' \? color\.moneyOut : color\.moneyIn;/.test(read('src/screens/staff/KhataEntryForm.tsx')),'Add/Edit entry: same meaning');
 assert.ok(/const cls = t\.type === 'lena' \? 'out' : 'in';/.test(read('src/utils/pdfGenerator.ts')),'Khata PDF: same meaning');

 // ── Batch 1 screens: tokens only, no emoji, sentence case ───────────────────────
 const emoji=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
 for(const f of ['src/screens/staff/CustomerDetailScreen.tsx','src/screens/staff/ReminderModal.tsx','src/screens/staff/AddTransactionScreen.tsx','src/screens/staff/EditTransactionScreen.tsx','src/screens/staff/KhataEntryForm.tsx','src/screens/auth/LoginScreen.tsx','src/screens/staff/ChangePasswordScreen.tsx','src/components/CountryCodePicker.tsx','src/navigation/AppNavigator.tsx','src/components/AmbientBackground.tsx']){
  const src=read(f);
  assert.equal((src.match(/#[0-9A-Fa-f]{3,8}\b/g)||[]).length,0,f+' has a hardcoded colour');
  assert.ok(!/themeColors|className=|rgba\(/.test(src),f+' still uses the old theme');
  assert.ok(!/fontWeight: '(bold|[6-9]00)'/.test(src),f+' uses a third weight');
  assert.ok(!src.split('\n').some(l=>emoji.test(l)&&!/^\s*(\/\/|\*)/.test(l)),f+' renders an emoji');
 }
 assert.ok(/DefaultTheme/.test(read('src/navigation/AppNavigator.tsx'))&&!/DarkTheme/.test(read('src/navigation/AppNavigator.tsx')),'no dark navigation theme behind the light screens');
}));

check(113,'batch 3: search finds real customers and treats % and _ literally; unpaid bills = posted with a balance; receiving and supplier returns are validated and all-or-nothing; Sync Center dismisses instead of deleting; batch-3 screens on tokens',at('src/services/database/searchDb.ts','executeGlobalSearch'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const search=h.load('src/services/database/searchDb.ts');
 // Customers come from the customers table (it used to search the users table).
 h.insert('customers',{id:'c_real',user_id:'owner',name:'Zubair Traders',phone:'0300 1112223',cnic:'34101-2345678-9'});
 h.insert('customers',{id:'c_pct',user_id:'owner',name:'Deal 50% off',phone:'0300 9999999'});
 h.insert('customers',{id:'c_gone',user_id:'owner',name:'Zubair Deleted',phone:'0300 5550000',is_deleted:1});
 const cust=q=>search.executeGlobalSearch(q,'owner').then(r=>r.filter(x=>x.type==='customer').map(x=>x.id).sort());
 assert.deepEqual(plain(await cust('Zubair')),['c_real'],'real customer found, deleted one hidden');
 assert.deepEqual(plain(await cust('50%')),['c_pct'],'% is a character, not a wildcard');
 assert.deepEqual(plain(await cust('%')),['c_pct'],'a lone % does not match everything');
 assert.deepEqual(plain(await cust('_')),[],'_ is a character, not a wildcard');
 assert.deepEqual(plain(await cust('(')),[],'regex characters do not throw');
 assert.deepEqual(plain(await cust('3410123456789')),[],'the national ID is not searchable');
 assert.ok(!JSON.stringify(await search.executeGlobalSearch('Zubair','owner')).includes('34101'),'and never returned');

 // Unpaid bills: posted (not draft/hold), not deleted, balance above zero.
 const bill=(id,due,extra={})=>h.insert('bills',{id,user_id:'owner',bill_no:Number(id.replace(/\D/g,''))||1,party_name:'A',bill_date:'2026-09-10',subtotal:1000,total:1000,paid:1000-due,due,status:due?'unpaid':'paid',is_draft:0,is_hold:0,...extra});
 bill('u1',1000);bill('u2',0);bill('u3',400,{is_draft:1});bill('u4',400,{is_hold:1});bill('u5',400,{is_deleted:1});bill('u6',250);
 assert.deepEqual(plain((await h.load('src/services/database/billDb.ts').getUnpaidBills('owner')).map(b=>b.id).sort()),['u1','u6']);

 // Receive goods: validated against what is still outstanding, all-or-nothing.
 const pdb=h.load('src/services/database/purchaseDb.ts');
 h.insert('stock_items',{id:'st1',user_id:'owner',name_en:'Rice',purchase_price:4000,sale_price:6000,quantity:0});
 h.insert('purchase_orders',{id:'po1',user_id:'owner',supplier_id:'sup1',po_number:1,order_date:'2026-09-10',status:'sent',total:40000,is_deleted:0});
 h.insert('purchase_order_items',{id:'poi1',po_id:'po1',stock_item_id:'st1',item_name:'Rice',quantity:10,unit_cost:4000,line_total:40000,received_qty:0});
 h.insert('purchase_order_items',{id:'poi2',po_id:'po1',stock_item_id:null,item_name:'Bags',quantity:5,unit_cost:100,line_total:500,received_qty:0});
 const qty=()=>h.one('SELECT quantity FROM stock_items WHERE id=?','st1').quantity;
 const got=id=>h.one('SELECT received_qty FROM purchase_order_items WHERE id=?',id).received_qty;
 await assert.rejects(pdb.receiveGoods('po1','owner',[{itemId:'poi1',itemName:'Rice',receivedQty:4,unitCost:4000},{itemId:'poi2',itemName:'Bags',receivedQty:6,unitCost:100}]),/Only 5 of Bags/);
 assert.deepEqual([got('poi1'),got('poi2'),qty()],[0,0,0],'a failing line leaves the whole receipt unwritten');
 await assert.rejects(pdb.receiveGoods('po1','owner',[{itemId:'poi1',itemName:'Rice',receivedQty:-2,unitCost:4000}]),/Invalid quantity/);
 await assert.rejects(pdb.receiveGoods('po1','owner',[{itemId:'poi1',itemName:'Rice',receivedQty:0,unitCost:4000}]),/at least one/);
 await pdb.receiveGoods('po1','owner',[{itemId:'poi1',itemName:'Rice',receivedQty:4,unitCost:4000}]);
 assert.deepEqual([got('poi1'),qty(),h.one('SELECT status FROM purchase_orders WHERE id=?','po1').status],[4,4,'partial']);
 await pdb.receiveGoods('po1','owner',[{itemId:'poi1',itemName:'Rice',receivedQty:6,unitCost:4000},{itemId:'poi2',itemName:'Bags',receivedQty:5,unitCost:100}]);
 const po=h.one('SELECT status,received_total FROM purchase_orders WHERE id=?','po1');
 assert.deepEqual([qty(),po.status,po.received_total],[10,'received',40500],'stock only for the linked line; total in paisa');

 // Supplier return: never more than invoiced minus earlier returns, all-or-nothing.
 h.insert('purchase_invoices',{id:'pi1',user_id:'owner',supplier_id:'sup1',invoice_number:'INV-1',invoice_date:'2026-09-11',subtotal:40000,total:40000,amount_paid:0,status:'unpaid',is_deleted:0});
 h.insert('purchase_invoice_items',{id:'pii1',invoice_id:'pi1',stock_item_id:'st1',item_name:'Rice',quantity:10,unit_cost:4000,line_total:40000});
 const ret=(q,date='2026-09-12')=>pdb.createPurchaseReturn('owner','pi1','sup1',[{stock_item_id:'st1',item_name:'Rice',quantity:q,unit_cost:4000,line_total:0}],date);
 await assert.rejects(ret(11),/Only 10 of Rice/);
 await assert.rejects(ret(0),/Invalid quantity/);
 await assert.rejects(ret(1,'2026-13-40'),/Invalid return date/);
 assert.equal(h.one('SELECT COUNT(*) n FROM purchase_returns').n,0,'rejected returns write nothing');
 const r1=await ret(7);assert.equal(r1.total_refund,28000,'refund computed here, in paisa');assert.equal(qty(),3);
 await assert.rejects(ret(4),/Only 3 of Rice/,'earlier returns count');
 assert.deepEqual([h.one('SELECT COUNT(*) n FROM purchase_returns').n,qty()],[1,3]);

 // Sync Center: failed uploads are dismissed, never deleted; counts cover pending + failed.
 const sc=read('src/screens/sync/SyncCenterScreen.tsx');
 assert.ok(!/DELETE FROM sync_queue/i.test(sc),'Sync Center must not hard-delete the queue');
 assert.ok(/SET status = 'dismissed' WHERE status = 'failed'/.test(sc));
 for(const m of read('src/services/syncProcessor.ts').match(/SELECT COUNT\(\*\) as count FROM sync_queue[^`]*/g)||[])assert.ok(/status IN \('pending', 'failed'\)/.test(m),'count: '+m);

 // Batch 3 screens: tokens only, no emoji, two weights.
 const emoji=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2713}\u{2715}]/u;
 for(const f of ['src/screens/sync/SyncCenterScreen.tsx','src/screens/PurchaseBook/PurchaseReturnModal.tsx','src/screens/PurchaseBook/ReceiveGoodsModal.tsx','src/screens/search/GlobalSearchScreen.tsx','src/screens/reminders/RemindersCenterScreen.tsx','src/screens/reminders/AddReminderScreen.tsx','src/components/ui/EntryHistory.tsx','src/screens/admin/ActivityLog.tsx','src/screens/StaffBook/StaffAttendanceScreen.tsx','src/components/Download/DownloadOptionsModal.tsx','src/components/TranslateToUrdu.tsx']){
  const src=read(f);
  assert.equal((src.match(/#[0-9A-Fa-f]{3,8}\b/g)||[]).length,0,f+' has a hardcoded colour');
  assert.ok(!/themeColors|className=|rgba\(/.test(src),f+' still uses the old theme');
  assert.ok(!/fontWeight: '(bold|[6-9]00)'/.test(src),f+' uses a third weight');
  assert.ok(!src.split('\n').some(l=>emoji.test(l)&&!/^\s*(\/\/|\*)/.test(l)),f+' renders an emoji');
 }
}));

check(114,'suppliers: a payment is validated, all-or-nothing and settles its invoice; the payment screen calls the real store action in rupees; supplier screens on tokens with country-aware WhatsApp; every console call is dev-only',at('src/services/database/supplierDb.ts','addSupplierPayment'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const sdb=h.load('src/services/database/supplierDb.ts');
 h.insert('suppliers',{id:'sp1',user_id:'owner',name:'Karachi Rice Co'});
 h.insert('purchase_invoices',{id:'pv1',user_id:'owner',supplier_id:'sp1',invoice_number:'INV-9',invoice_date:'2026-09-11',subtotal:50000,total:50000,amount_paid:0,balance_due:50000,status:'unpaid',is_deleted:0});
 const inv=()=>plain(h.one('SELECT amount_paid,balance_due,status FROM purchase_invoices WHERE id=?','pv1'));
 const count=()=>h.one('SELECT COUNT(*) n FROM supplier_payments').n;
 await assert.rejects(sdb.addSupplierPayment('owner','sp1',60000,'2026-09-12','cash','pv1'),/more than the balance/);
 await assert.rejects(sdb.addSupplierPayment('owner','sp1',0,'2026-09-12','cash'),/above zero/);
 await assert.rejects(sdb.addSupplierPayment('owner','sp1',12.5,'2026-09-12','cash'),/above zero/,'paisa are whole');
 await assert.rejects(sdb.addSupplierPayment('owner','nobody',100,'2026-09-12','cash'),/Supplier not found/);
 await assert.rejects(sdb.addSupplierPayment('owner','sp1',100,'2026-09-12','cash','missing'),/Invoice not found/);
 assert.equal(count(),0,'rejected payments write nothing');
 assert.deepEqual(inv(),{amount_paid:0,balance_due:50000,status:'unpaid'});
 const p=await sdb.addSupplierPayment('owner','sp1',20000,'2026-09-12','cheque','pv1','CHQ-1');
 assert.equal(p.reference,'CHQ-1');assert.deepEqual(inv(),{amount_paid:20000,balance_due:30000,status:'partial'});
 await sdb.addSupplierPayment('owner','sp1',30000,'2026-09-13','cash','pv1');
 assert.deepEqual(inv(),{amount_paid:50000,balance_due:0,status:'paid'});
 await sdb.addSupplierPayment('owner','sp1',700,'2026-09-13','cash');
 assert.equal(count(),3);
 assert.equal(h.all('SELECT * FROM sync_queue WHERE table_name=?','supplier_payments').length,3,'each payment is queued for sync');

 const modal=read('src/screens/StockBook/AddSupplierPaymentModal.tsx');
 assert.ok(/recordPayment/.test(modal)&&!/addPayment/.test(modal),'the payment screen calls the store action that exists');
 assert.ok(/paisaToRupeesString\(maxAmount\)/.test(modal),'the invoice balance (paisa) is prefilled in rupees');
 assert.ok(/Promise<SupplierPayment>/.test(read('src/store/useSupplierStore.ts')),'the store hands back the saved payment');
 for(const f of ['src/screens/StaffBook/AddStaffModal.tsx','src/screens/StockBook/AddItemModal.tsx'])
  assert.ok(!/<TranslateToUrdu[^>]*(sourceText|onChangeText)/.test(read(f)),f+': TranslateToUrdu takes onSave');

 const emoji=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2713}\u{2715}]/u;
 for(const f of ['src/screens/StockBook/SuppliersScreen.tsx','src/screens/StockBook/SupplierProfileScreen.tsx','src/screens/StockBook/SupplierLedgerScreen.tsx','src/screens/StockBook/AddSupplierPaymentModal.tsx']){
  const src=read(f);
  assert.equal((src.match(/#[0-9A-Fa-f]{3,8}\b/g)||[]).length,0,f+' has a hardcoded colour');
  assert.ok(!/themeColors|className=|rgba\(/.test(src),f+' still uses the old theme');
  assert.ok(!/fontWeight: '(bold|[6-9]00)'/.test(src),f+' uses a third weight');
  assert.ok(!src.split('\n').some(l=>emoji.test(l)&&!/^\s*(\/\/|\*)/.test(l)),f+' renders an emoji');
  assert.ok(!/phone=92\$\{/.test(src),f+' hardcodes the Pakistan code for WhatsApp');
 }

 // Salary opens from staff details only (the list's duplicate Salary button was removed on request).
 assert.ok(!/StaffSalaryDetail/.test(read('src/screens/StaffBook/StaffBookScreen.tsx')),'no Salary shortcut on the Staff Book list');
 assert.ok(/navigation\.navigate\('StaffSalaryDetail', \{ staff \}\)/.test(read('src/screens/StaffBook/StaffDetail.tsx')),'salary still reachable from staff details');

 // Every console call in the app is behind __DEV__ (same line, or inside an if (__DEV__) block).
 for(const f of sourceFiles().filter(p=>/[\\/]src[\\/]/.test(p))){
  const lines=fs.readFileSync(f,'utf8').split(/\r?\n/);
  lines.forEach((l,i)=>{
   if(!/console\.(log|error|warn|info)\(/.test(l)||/__DEV__/.test(l)||/^\s*(\/\/|\*)/.test(l))return;
   const ind=l.match(/^\s*/)[0].length;let ok=false;
   for(let j=i-1;j>=Math.max(0,i-8);j--){const pj=lines[j],ij=pj.match(/^\s*/)[0].length;if(pj.trim()&&ij<ind){ok=/__DEV__/.test(pj);break;}}
   assert.ok(ok,f+':'+(i+1)+' logs outside __DEV__');
  });
 }
}));

check(115,'every account is its own business: stock is own-only with a read-only drill-down, stock writes are the author\'s alone, the per-customer khata ledger drills down, and every book screen opens read-only from Staff Book',at('src/services/database/entryScope.ts','entryOwner'),()=>isolated(async h=>{
 seedPeople(h);
 const st=h.load('src/services/database/stockDb.ts');
 for(const who of ['owner','staffA','subA','staffB'])h.insert('stock_items',{id:'it_'+who,user_id:who,name_en:'Item '+who,purchase_price:1000,sale_price:1500,quantity:10});
 // Own inventory: items and value are the viewer's own.
 for(const who of ['owner','staffA','subA'])assert.deepEqual((await st.getStockItemsByUserId(who)).map(i=>i.id),['it_'+who],who);
 assert.equal(await st.calculateTotalStockValue('owner'),10000,'own value only');
 // Drill-down: downward only, read-only.
 assert.deepEqual((await st.getStockItemsByUserId('owner',false,'subA')).map(i=>i.id),['it_subA']);
 assert.equal(await st.calculateTotalStockValue('owner','staffA'),10000);
 // Two levels: a staff member reaches nobody, so a peer, a parent and a sibling are all refused.
 for(const [viewer,target] of [['staffA','subA'],['staffA','staffB'],['subA','staffA'],['staffA','owner']])await assert.rejects(st.getStockItemsByUserId(viewer,false,target),/own team/);
 // Writes: nobody moves or deletes someone else's stock — not even the owner.
 await assert.rejects(st.addStockMovement({item_id:'it_subA',change:5,reason:'purchase',date:'2026-09-10',user_id:'owner'}),/your own stock/);
 await assert.rejects(st.deleteStockItem('it_subA','staffA'),/your own stock/);
 assert.equal(h.one("SELECT quantity FROM stock_items WHERE id='it_subA'").quantity,10,'untouched');
 await st.addStockMovement({item_id:'it_subA',change:5,reason:'purchase',date:'2026-09-10',user_id:'subA'});
 assert.equal(h.one("SELECT quantity FROM stock_items WHERE id='it_subA'").quantity,15,'the author moves their own');

 // Khata per-customer ledger: own-only, drill-down downward.
 const kh=khata(h);
 h.insert('transactions',{id:'k1',userId:'subA',partyName:'Hamid',amount_paisa:5000,type:'lena',date:'2026-09-10'});
 h.insert('transactions',{id:'k2',userId:'subA',partyName:'Hamid',amount_paisa:2000,type:'dena',date:'2026-09-11'});
 h.insert('transactions',{id:'k3',userId:'owner',partyName:'Hamid',amount_paisa:900,type:'lena',date:'2026-09-11'});
 assert.deepEqual(plain(await kh.getPartySummary('owner','Hamid')),{totalLena:900,totalDena:0,netBalance:900},'the owner\'s own Hamid only');
 assert.deepEqual(plain(await kh.getPartySummary('owner','Hamid','subA')),{totalLena:5000,totalDena:2000,netBalance:3000},'subA\'s Hamid via drill-down');
 assert.deepEqual((await kh.getTransactionsByParty('owner','Hamid','subA')).map(t=>t.id),['k2','k1']);
 assert.equal((await kh.getPartyBalances('owner',{},'subA')).rows.find(p=>p.partyName==='Hamid').netBalance,3000);
 // A peer staff member is refused, same as any other account outside the viewer's team.
 for(const viewer of ['staffA','staffB'])await assert.rejects(kh.getPartyBalances(viewer,{},'subA'),/own team/);

 // Screens: every book opens from Staff Book → Entries, read-only.
 const entries=read('src/screens/StaffBook/StaffEntriesScreen.tsx');
 for(const [book,route] of [['cash','CashBook'],['khata','StaffKhata'],['bill','BillBook'],['expense','ExpensesTab'],['stock','StockBook'],['purchase','PurchaseBook'],['customer','CustomerBook']])
  assert.ok(new RegExp("key: '"+book+"'[^}]*route: '"+route+"'").test(entries),book+' opens '+route);
 for(const nav of ['src/navigation/AdminNavigator.tsx'])assert.ok(/name="StaffKhata" component=\{KhataScreen\}/.test(read(nav)),nav+' registers StaffKhata');
 const screens={
  'src/screens/staff/KhataScreen.tsx':[/createdBy: viewAs\.userId/],
  'src/screens/staff/CustomerDetailScreen.tsx':[/getTransactionsByParty\(userId, partyName, viewAs\?\.userId\)/,/\{!viewAs && \(/],
  'src/screens/ExpenseBook/ExpenseBookScreen.tsx':[/fetchExpenses\(user\.id, undefined, viewAs\?\.userId\)/,/!isKeyboardVisible && !viewAs/],
  'src/screens/BillBook/BillBookScreen.tsx':[/fetchBills\(user\.id, undefined, viewAs\?\.userId\)/,/!isKeyboardVisible && !viewAs/],
  'src/screens/StockBook/StockBookScreen.tsx':[/fetchItems\(user\.id, viewAs\?\.userId\)/,/readOnly: !!viewAs/,/!isKeyboardVisible && !viewAs/],
  'src/screens/StockBook/StockItemDetailScreen.tsx':[/\{!readOnly && \(/],
  'src/screens/PurchaseBook/PurchaseBookScreen.tsx':[/loadLists\(user\.id, viewAs\?\.userId\)/,/!isKeyboardVisible && !viewAs/],
  'src/screens/CustomerBook/CustomerBookScreen.tsx':[/disabled=\{!!viewAs\}/,/!isKeyboardVisible && !viewAs/],
 };
 // The Khata customer list is rendered BY KhataScreen, so the banner is the screen's job
 // and the scoping is the list's: it must take the drill-down id, never the viewer's own.
 {const list=read('src/components/khata/CustomerBalanceList.tsx');
  assert.ok(/getPartyBalances\(userId, \{ search/.test(list),'the customer list must search in SQL');
  assert.ok(/viewAs\?\.userId\)/.test(list),'the customer list must pass the drill-down id through to the query');
  assert.ok(!/ReadOnlyBanner/.test(list),'the banner belongs to KhataScreen — two banners would stack');}
 for(const [file,pins] of Object.entries(screens)){const src=read(file);
  if(!file.includes('StockItemDetail'))assert.ok(/ReadOnlyBanner/.test(src),file+' shows whose book it is');
  for(const p of pins)assert.ok(p.test(src),file+' '+p);
 }
 // Stores never keep a drill-down in the shared filter, so the own book can't show someone else's rows.
 for(const store of ['src/store/useExpenseStore.ts','src/store/useBillStore.ts']){const src=read(store);
  assert.ok(/const \{ createdBy: _ignored, \.\.\.clean \} = filter;/.test(src)&&/const \{ createdBy: _ignored, \.\.\.active \} = filter \?\? get\(\)\.filter;/.test(src),store);
 }
 // No book data file scopes by the team any more (Staff Book, monitoring and reports excepted).
 for(const file of ['expenseDb','billDb','customerDb','stockDb','transactionDb','reminderDb','searchDb','cashbookDb'].map(n=>'src/services/database/'+n+'.ts'))
  assert.ok(!/SELECT id FROM users WHERE parentId/.test(read(file).split('export const getAllStaffMetricsAggregate')[0]),file+' is own-only');
}));

check(116,'one portal: every account — admin, staff and sub-staff — gets the same navigator, home and seven reports; the Staff Book is own-only and nests sub-staff under their staff member',at('src/navigation/AppNavigator.tsx','AdminNavigator'),()=>isolated(async h=>{
 // One navigator for everyone: no role branch, and no staff-only copy of anything.
 const app=read('src/navigation/AppNavigator.tsx');
 assert.ok(/\{!isAuthenticated \? <AuthNavigator \/> : <AdminNavigator \/>\}/.test(app),'one portal for every role');
 assert.ok(!/StaffNavigator/.test(app),'no role-specific navigator');
 for(const gone of ['src/navigation/StaffNavigator.tsx','src/screens/staff/HomeScreen.tsx','src/screens/reports/ReportsMenuScreen.tsx',
   'src/screens/reports/FinancialReportsScreen.tsx','src/screens/reports/InventoryReportsScreen.tsx','src/screens/reports/PeopleReportsScreen.tsx'])
  assert.ok(!fs.existsSync(path.join(root,gone)),gone+' must stay deleted');
 // The shared home keeps every way in that the old staff home had.
 const home=read('src/screens/admin/AdminDashboard.tsx');
 for(const route of ['GlobalSearch','SyncCenter','RemindersCenter','ActivityLog'])
  assert.ok(new RegExp("navigate\\('"+route+"'\\)").test(home),'home reaches '+route);
 assert.ok(!/getUsersInScope/.test(home),'home stays a books screen, with no staff list');
 // The seven reports are the Reports tab for everyone, and each can be exported.
 const hub=read('src/screens/reports/ReportsDashboardScreen.tsx'),nav=read('src/navigation/AdminNavigator.tsx');
 for(const [screen,file] of [['SalesReport','SalesReportScreen'],['ProfitLossReport','ProfitLossReportScreen'],['ExpenseReport','ExpenseReportScreen'],
   ['CashFlowReport','CashFlowReportScreen'],['InventoryReport','InventoryReportScreen'],['PartyReport','PartyReportScreen'],['StaffReport','StaffReportScreen']]){
  assert.ok(hub.includes("screen: '"+screen+"'"),'Reports offers '+screen);
  assert.ok(new RegExp('name="'+screen+'"').test(nav),nav+' registers '+screen);
  assert.ok(/handleReportExport\(/.test(read('src/screens/reports/'+file+'.tsx')),file+' exports');
 }
 assert.ok(!/ReportsMenu|FinancialReports|InventoryReports|PeopleReports/.test(nav),'the old grouped reports are gone from the navigator');

 // Staff Book: the people YOU added; a staff member's own sub-staff live in their profile.
 seedPeople(h);const sdb=h.load('src/services/database/staffDb.ts');
 const rec=(id,owner)=>h.insert('staff_records',{id,user_id:owner,name_en:id,phone:'0300000000'+id.length,role:'Sales',joining_date:'2026-09-01',status:'active'});
 rec('sr_staffA','owner');rec('sr_staffB','owner');rec('sr_subA','staffA');rec('sr_subB','staffB');
 assert.deepEqual(plain((await sdb.getStaffRecords('owner')).map(r=>r.id).sort()),['sr_staffA','sr_staffB'],'the owner sees the staff they added, not sub-staff as peers');
 assert.deepEqual(plain((await sdb.getStaffRecords('staffA')).map(r=>r.id)),['sr_subA'],'a staff member sees their own sub-staff');
 assert.deepEqual(plain((await sdb.getStaffRecords('owner','staffA')).map(r=>r.id)),['sr_subA'],'admin → staff → sub-staff');
 for(const [viewer,target] of [['staffA','staffB'],['subA','staffA'],['staffB','owner']])
  await assert.rejects(sdb.getStaffRecords(viewer,target),/own team/,viewer+' may not open '+target);
 // The roster export shows the same people the screen does.
 const staffPdf=read('src/components/Download/pdfGenerator.ts');
 assert.ok(/FROM staff_records\s*\n\s*WHERE user_id = \?/.test(staffPdf),'the staff roster export is own-only');
 assert.ok(!/hierarchyFilter/.test(staffPdf),'no team filter left in the export');
 // The profile nests sub-staff and opens each one's own profile.
 const detail=read('src/screens/StaffBook/StaffDetail.tsx');
 assert.ok(/getStaffRecords\(user\.id, ownerId\)/.test(detail),'the profile loads that person\'s own sub-staff');
 assert.ok(/navigation\.push\('StaffDetailBook', \{ staff: sub \}\)/.test(detail),'each sub-staff opens their own profile');
}));

check(117,'Stock IN and OUT reports are per item: each item\'s total equals its own movements, the items add up to the whole-range total, paging never changes a total, and each direction shows only its own movements',at('src/services/database/stockDb.ts','getStockMovementItems'),()=>isolated(async h=>{
 seedPeople(h);const api=h.load('src/services/database/stockDb.ts');
 const range={startDate:'2026-09-01',endDate:'2026-09-30'};
 const names=['Aata','Basmati','Chai','Daal','Elaichi','Firni','Ghee','Haldi'];
 let n=0;const expected={};
 for(const [i2,name] of names.entries()){
  const id='it_'+i2;h.insert('stock_items',{id,user_id:'owner',name_en:name,purchase_price:1000,sale_price:1500,quantity:0});
  expected[id]={qty:0,amount:0,entries:0};
  for(let k=0;k<14;k++){
   n++;const inDay='2026-09-'+String((k%28)+1).padStart(2,'0');
   const qty=1+(k%4),cost=1000+(k*7);
   h.insert('stock_movements',{id:'mv_in_'+n,item_id:id,user_id:'owner',change:qty,reason:'purchase',date:inDay,cost_per_unit:cost});
   expected[id].qty+=qty;expected[id].amount+=qty*cost;expected[id].entries++;
   // Out movements and other months must never reach a stock IN report.
   h.insert('stock_movements',{id:'mv_out_'+n,item_id:id,user_id:'owner',change:-qty,reason:'sale',date:inDay,sale_price_unit:9999});
   h.insert('stock_movements',{id:'mv_old_'+n,item_id:id,user_id:'owner',change:qty,reason:'purchase',date:'2026-08-15',cost_per_unit:cost});
  }
 }
 // Another account's item never appears in this owner's report.
 h.insert('stock_items',{id:'it_other',user_id:'staffB',name_en:'Aata',purchase_price:1,sale_price:1,quantity:0});
 h.insert('stock_movements',{id:'mv_other',item_id:'it_other',user_id:'staffB',change:99,reason:'purchase',date:'2026-09-10',cost_per_unit:777});

 const page=async (limit,dir='in')=>{const out=[];let cur=null,guard=0;do{const p=await api.getStockMovementItems('owner',dir,range,limit,cur);out.push(...p.rows);cur=p.nextCursor;assert.ok(++guard<200,'runaway');}while(cur);return out;};
 const all=await page(-1);
 assert.deepEqual(plain(all.map(r=>r.name_en)),names,'one row per item that moved, by name');
 assert.ok(!all.some(r=>r.item_id==='it_other'),'another account never appears');

 // Each item's row equals that item's own movements — the per-item view's query.
 for(const row of all){
  const own=await api.getStockMovementReport('owner','in',range.startDate,range.endDate,-1,null,undefined,row.item_id);
  assert.equal(own.summary.qty,row.qty,row.name_en+' qty');
  assert.equal(own.summary.amount,row.amount,row.name_en+' amount');
  assert.equal(own.summary.entries,row.entries,row.name_en+' entries');
  assert.deepEqual(plain({qty:row.qty,amount:row.amount,entries:row.entries}),plain(expected[row.item_id]),row.name_en+' vs fixture');
  assert.ok(own.rows.every(m=>m.change>0&&m.item_id===row.item_id),'stock in only, this item only');
 }
 // The items add up to the whole-range total the header shows.
 const whole=await api.getStockMovementReport('owner','in',range.startDate,range.endDate,0);
 assert.equal(all.reduce((a,r)=>a+r.qty,0),whole.summary.qty,'items add up to the header qty');
 assert.equal(all.reduce((a,r)=>a+r.amount,0),whole.summary.amount,'items add up to the header amount');
 assert.equal(all.reduce((a,r)=>a+r.entries,0),whole.summary.entries,'and to the entry count');

 // Paging changes nothing: same rows in the same order, and the header is one aggregate.
 for(const limit of [1,3,50]){
  const paged=await page(limit);
  assert.deepEqual(plain(paged.map(r=>r.item_id)),plain(all.map(r=>r.item_id)),'page size '+limit+': same items, same order');
  assert.deepEqual(plain(paged.map(r=>r.qty+':'+r.amount)),plain(all.map(r=>r.qty+':'+r.amount)),'page size '+limit+': same totals');
  assert.equal(new Set(paged.map(r=>r.item_id)).size,paged.length,'no duplicates across pages');
 }
 // ── The SAME properties for stock OUT ────────────────────────────────────────
 const allOut=await page(-1,'out');
 assert.deepEqual(plain(allOut.map(r=>r.name_en)),names,'one row per item that went out, by name');
 for(const row of allOut){
  const own=await api.getStockMovementReport('owner','out',range.startDate,range.endDate,-1,null,undefined,row.item_id);
  assert.equal(own.summary.qty,row.qty,row.name_en+' out qty');
  assert.equal(own.summary.amount,row.amount,row.name_en+' out amount');
  assert.equal(own.summary.entries,row.entries,row.name_en+' out entries');
  assert.ok(own.rows.every(m=>m.change<0&&m.item_id===row.item_id),'stock out only, this item only');
  assert.equal(row.amount,9999*expected[row.item_id].qty,'the out report values at the selling price');
 }
 const wholeOut=await api.getStockMovementReport('owner','out',range.startDate,range.endDate,0);
 assert.equal(allOut.reduce((a,r)=>a+r.qty,0),wholeOut.summary.qty,'items add up to the out header qty');
 assert.equal(allOut.reduce((a,r)=>a+r.amount,0),wholeOut.summary.amount,'items add up to the out header amount');
 for(const limit of [1,3,50]){
  const paged=await page(limit,'out');
  assert.deepEqual(plain(paged.map(r=>r.item_id)),plain(allOut.map(r=>r.item_id)),'out page size '+limit+': same items, same order');
  assert.deepEqual(plain(paged.map(r=>r.qty+':'+r.amount)),plain(allOut.map(r=>r.qty+':'+r.amount)),'out page size '+limit+': same totals');
 }
 // Neither direction can borrow the other's movements.
 assert.notDeepEqual(plain(all.map(r=>r.amount)),plain(allOut.map(r=>r.amount)),'in and out are valued separately');

 // The search narrows in SQL, in both directions.
 assert.deepEqual(plain((await api.getStockMovementItems('owner','out',{...range,search:'aat'},-1,null)).rows.map(r=>r.name_en)),['Aata'],'out search narrows too');
 const searched=await api.getStockMovementItems('owner','in',{...range,search:'aat'},-1,null);
 assert.deepEqual(plain(searched.rows.map(r=>r.name_en)),['Aata'],'search narrows the item list');
 // An item's export covers that item alone, through the same query.
 assert.ok(/options.itemId/.test(read('src/components/Download/pdfGenerator.ts')),'the export filters by item');
 assert.ok(/itemId,/.test(read('src/components/Download/DownloadOptionsModal.tsx')),'the download sheet carries the item');
}));

check(118,'a bill\'s status is READ OFF its figures — never chosen: a new bill is unpaid with due = total, paid above the total is refused and writes nothing, an edit keeps what was received, and the form has no Paid / Unpaid buttons',at('src/services/database/billDb.ts','const paid = Math.max(0'),()=>isolated(async h=>{
 seedPeople(h);h.login('staffA');
 const api=billDb(h);
 const line=(price,qty)=>({ item_id:null, item_name:'Rice', quantity:qty, unit_price:price, line_total:price*qty });
 const make=async (paid)=>api.createBill({ user_id:'staffA', customer_id:'walk_in', party_name:'Ali', bill_date:'2026-09-11',
   subtotal:50000, discount_pct:0, discount_amount:0, tax_amount:0, total:50000, paid, due:0, status:'paid', payment_method:'cash', is_draft:0, is_hold:0 },[line(25000,2)]);

 // A new bill: nothing received, so it owes the whole total and says unpaid.
 const plain1=await make(undefined);
 const row=id=>plain(h.one('SELECT paid,due,total,status FROM bills WHERE id=?',id));
 assert.deepEqual(row(plain1.id),{paid:0,due:50000,total:50000,status:'unpaid'},'a new bill starts unpaid, owing the total');
 // Whatever the caller claims about due or status, the figures win.
 const part=await make(20000);
 assert.deepEqual(row(part.id),{paid:20000,due:30000,total:50000,status:'partial'},'part paid: due is the remainder, status partial');
 const full=await make(50000);
 assert.deepEqual(row(full.id),{paid:50000,due:0,total:50000,status:'paid'},'paid in full: nothing due, status paid');

 // More than the total is refused outright — nothing is written.
 const before=h.one('SELECT COUNT(*) n FROM bills').n;
 await assert.rejects(make(50001),/more than the bill total/);
 assert.equal(h.one('SELECT COUNT(*) n FROM bills').n,before,'the rejected bill was not created');

 // total − paid = due holds through an edit, and what was received stays.
 await api.saveBillEdit(part.id,'staffA',{ customer_id:'walk_in', party_name:'Ali', bill_date:'2026-09-11',
   lines:[{ item_id:null, item_name:'Rice', quantity:3, unit_price:25000 }] });
 const edited=row(part.id);
 assert.equal(edited.total,75000,'the new total');
 assert.equal(edited.paid,20000,'what was received stays with the bill');
 assert.equal(edited.due,edited.total-edited.paid,'due is total minus paid');
 assert.equal(edited.status,'partial','and the status still follows the figures');
 // Shrinking below what was received cannot leave paid above total, or a false status.
 await api.saveBillEdit(part.id,'staffA',{ customer_id:'walk_in', party_name:'Ali', bill_date:'2026-09-11',
   lines:[{ item_id:null, item_name:'Rice', quantity:1, unit_price:10000 }] });
 const small=row(part.id);
 assert.equal(small.total,10000);assert.equal(small.paid,10000,'paid never exceeds the total');
 assert.equal(small.due,0);assert.equal(small.status,'paid','status agrees with the figures');

 // Every bill in the book agrees with its own figures — status can never contradict them.
 for(const b of h.all('SELECT paid,due,total,status FROM bills')){
  assert.equal(b.due,b.total-b.paid,'total − paid = due');
  assert.equal(b.status,b.paid>=b.total&&b.total>0?'paid':b.paid===0?'unpaid':'partial','status matches the figures');
 }
 // An edit can record a payment, and more than the bill is refused there too.
 const paidCase=await make(0);
 await api.saveBillEdit(paidCase.id,'staffA',{ customer_id:'walk_in', party_name:'Ali', bill_date:'2026-09-11', paid:15000,
   lines:[{ item_id:null, item_name:'Rice', quantity:2, unit_price:25000 }] });
 assert.deepEqual(row(paidCase.id),{paid:15000,due:35000,total:50000,status:'partial'},'the edit records what was paid');
 await assert.rejects(api.saveBillEdit(paidCase.id,'staffA',{ customer_id:'walk_in', party_name:'Ali', bill_date:'2026-09-11', paid:50001,
   lines:[{ item_id:null, item_name:'Rice', quantity:2, unit_price:25000 }] }),/more than the bill total/);
 assert.deepEqual(row(paidCase.id),{paid:15000,due:35000,total:50000,status:'partial'},'the refused edit changed nothing');

 // The form: an optional amount paid, the due shown, and no Paid / Unpaid wording.
 const form=read('src/screens/BillBook/CreateNewBillModal.tsx');
 assert.ok(!/paidStatus|paidToggle/.test(form),'no Paid / Unpaid buttons on the bill form');
 assert.ok(/t\('billAmountPaid'\)/.test(form)&&/value=\{paidAmount\}/.test(form),'the amount paid can be typed');
 assert.ok(/const paidPaisa = paidAmount\.trim\(\) \? \(rupeesToPaisa\(paidAmount\) \?\? 0\) : 0;/.test(form),'rupees are converted once');
 assert.ok(/t\('billBalanceDue'\)/.test(form)&&/paisa=\{Math\.max\(0, calculatedTotal - paidPaisa\)\}/.test(form),'the due is shown as the difference');
 assert.ok(/paid: paidPaisa/.test(form),'the bill is saved with what was paid');
 assert.ok(!/payment: /.test(read('src/services/database/billDb.ts').split('export const saveBillEdit')[0]),'saveBillEdit takes no chosen payment state');

 // No paid / unpaid wording anywhere the owner reads a bill.
 const list=read('src/screens/BillBook/BillBookScreen.tsx');
 assert.ok(!/'Paid'|'Unpaid'|'Partial'|statusBadge|getStatusColor/.test(list),'the bill row shows no status word');
 assert.ok(/item\.due > 0 && <AmountText paisa=\{item\.due\} tone="out"/.test(list),'the row shows what is still owed instead');
 const gen=read('src/components/Download/pdfGenerator.ts');
 const billBranch=gen.slice(gen.indexOf("options.reportType === 'bill'"),gen.indexOf("options.reportType === 'staff'"));
 assert.ok(!/r.status/.test(billBranch),'the bill report prints no status column');
 assert.ok(!/'Status'/.test(billBranch),'nor a status heading in the CSV');
 assert.ok(!/<th>Status<\/th>/.test(read('src/components/Download/reportTemplates.ts').split('STAFF_REPORT')[0]),'nor does its template');
 const invoice=read('src/screens/BillBook/BillDetailScreen.tsx');
 assert.ok(/Received:/.test(invoice)&&/Balance due:/.test(invoice)&&!/bill\.status/.test(invoice),'the invoice shows figures, not a status word');
}));

check(119,'names follow the UI language, nothing else: Urdu shows the Urdu name and falls back to English, English always shows the English name, no code path reads a display mode, and switching language remounts the app',at('src/utils/displayName.ts','getDisplayName'),()=>isolated(async h=>{
 const dn=h.load('src/utils/displayName.ts').getDisplayName;
 const both={name_en:'Ahmed Ali',name_ur:'احمد علی'};
 const enOnly={name_en:'Rice 5kg'};
 const urOnly={name_ur:'چاول'};
 // Urdu UI: the Urdu name where one exists, the English one where it does not.
 assert.equal(dn(both,'ur'),'احمد علی');
 assert.equal(dn(enOnly,'ur'),'Rice 5kg','falls back to English, never blank');
 // English UI: always the English name, even when an Urdu one exists.
 assert.equal(dn(both,'en'),'Ahmed Ali');
 assert.equal(dn(enOnly,'en'),'Rice 5kg');
 // A row carrying only an Urdu name still shows something in either language.
 assert.equal(dn(urOnly,'en'),'چاول');assert.equal(dn(urOnly,'ur'),'چاول');
 // Never blank, and never a stock word on a person's row.
 for(const empty of [{},{name_en:''},{name_en:'',name_ur:''},null])for(const lang of ['en','ur']){
  const out=dn(empty,lang);
  assert.ok(out&&out.trim().length>0,'a name is never blank');
  assert.ok(!/stock item/i.test(out),'no stock wording as a fallback name: '+out);
 }
 // Every shape the books pass in resolves the same way through the ONE helper.
 assert.equal(dn({item_name_en:'Sugar',item_name_ur:'چینی'},'ur'),'چینی','stock rows');
 assert.equal(dn({partyName:'Bilal',party_name_ur:'بلال'},'ur'),'بلال','khata rows');
 assert.equal(dn({party_name:'Bilal Store',party_name_ur:'بلال سٹور'},'ur'),'بلال سٹور','bill rows');
 assert.equal(dn({partyName:'Bilal',party_name_ur:'بلال'},'en'),'Bilal');

 // The mode is gone: no store, no column read, no per-row flip, one helper only.
 assert.ok(!fs.existsSync(path.join(root,'src/store/useSettingsStore.ts')),'the display-mode store is deleted');
 for(const file of sourceFiles()){
  const src=fs.readFileSync(file,'utf8');
  assert.ok(!/nameDisplayMode|name_display_mode/.test(src.replace(/^\s*\/\/.*$/gm,'').replace(/name_display_mode TEXT[^\n]*/g,'')),file+' still reads a display mode');
  assert.ok(!/setLocalMode/.test(src),file+' still flips a name on tap');
 }
 assert.ok(!/nameDisplayLabel|bothNames|urduFallback/.test(read('src/i18n/en.ts')),'the settings keys are gone');
 assert.ok(!/nameDisplayLabel|bothNames|urduFallback/.test(read('src/i18n/ur.ts')),'in both dictionaries');
 // Screens resolve names ONLY through the shared helper.
 for(const file of sourceFiles().filter(p=>/screens|components/.test(p))){
  const src=fs.readFileSync(file,'utf8');
  if(!/getDisplayName\(/.test(src))continue;
  assert.ok(/from '.*utils\/displayName'/.test(src),file+' must use the shared helper');
  assert.ok(!/getDisplayName\([^)]*,\s*(?:localMode|nameDisplayMode|'both')/.test(src),file+' passes a mode');
 }
 // Switching the language remounts the tree, so every screen re-resolves its names.
 const nav=read('src/navigation/AppNavigator.tsx');
 assert.ok(/<NavigationContainer key=\{language\}/.test(nav),'the app remounts on a language change');
 assert.ok(/const \{ t, isLoaded, loadLanguage, language \} = useLanguageStore\(\);/.test(nav),'the language drives that key');
 // A fresh install opens in English while the Urdu dictionary is incomplete.
 const lang=read('src/store/useLanguageStore.ts');
 assert.ok(/language: 'en',/.test(lang),'the default language is English');
 assert.ok(!/stored === 'en' \|\| stored === 'ur' \? stored : 'ur'/.test(lang),'and an unreadable stored value falls back to English');
}));

check(112,'reports: posted bills only (drafts/holds are not sales), P&L and its trend run (they threw) and count each bill once, returns come off, cost matched by stock id not name, staff report = direct team with real counts, exports in rupees, report screens on tokens',at('src/services/database/reports/types.ts','postedBill'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const r=h.load('src/services/database/reports/index.ts');
 const f={startDate:'2026-09-01',endDate:'2026-09-30'};
 h.insert('stock_items',{id:'s1',user_id:'owner',name_en:'Rice',purchase_price:4000,sale_price:10000,quantity:10});
 // Another business owns an item with the SAME NAME and a huge cost — it must not leak into our COGS.
 h.insert('stock_items',{id:'x1',user_id:'otherOwner',name_en:'Rice',purchase_price:999999,sale_price:1,quantity:1});
 const bill=(id,total,extra={})=>h.insert('bills',{id,user_id:'owner',bill_no:Number(id.replace(/\D/g,''))||1,party_name:'A',bill_date:'2026-09-10',subtotal:total,total,paid:0,due:total,status:'unpaid',is_draft:0,is_hold:0,...extra});
 bill('b1',30000);
 h.insert('bill_items',{id:'i1',bill_id:'b1',item_id:'s1',item_name:'Rice',quantity:2,unit_price:10000,line_total:20000,returned_quantity:0});
 h.insert('bill_items',{id:'i2',bill_id:'b1',item_id:null,item_name:'Delivery',quantity:1,unit_price:10000,line_total:10000,returned_quantity:0});
 h.insert('bill_items',{id:'i3',bill_id:'b1',item_id:'s1',item_name:'Rice',quantity:50,unit_price:10000,line_total:500000,returned_quantity:0,is_deleted:1}); // removed by an edit
 bill('b2',99900,{is_draft:1});bill('b3',77700,{is_hold:1});
 h.insert('expenses',{id:'e1',user_id:'owner',amount:500,description:'x',category:'Fuel',expense_date:'2026-09-10'});

 // Sales = posted bills only.
 assert.equal(only((await r.getSalesReportSummary('owner',f)).totalSales,'totalSales'),30000,'drafts and holds are not sales');
 assert.equal((await r.getSalesReportSummary('owner',f)).totalBills,1);
 assert.deepEqual(plain((await r.getSalesTrend('owner',f)).map(t=>only(t.total,'trend'))),[30000]);
 // Top buyers come back grouped per currency; this fixture has exactly one group.
 assert.deepEqual(plain((await r.getCustomerPerformance('owner',f)).flatMap(g=>g.rows).map(c=>c.totalPurchases)),[30000]);

 // P&L runs (it threw "ambiguous column name"), deleted lines and other businesses' items stay out.
 const pl=await r.getProfitLossSummary('owner',f);
 assert.equal(pl.profitAvailable,true,'one currency, and it is the account default');
 assert.deepEqual(plain({rev:only(pl.totalRevenue,'revenue'),cogs:only(pl.totalCOGS,'cogs'),exp:only(pl.totalExpenses,'expenses'),net:pl.netProfit}),{rev:30000,cogs:8000,exp:500,net:21500});
 const trend=await r.getProfitTrend('owner',f);
 assert.deepEqual(plain(trend),[{date:'2026-09-10',profit:22000}],'the bill total is counted ONCE, not once per line');

 // Returns: one Rice comes back — its price leaves sales, its cost leaves COGS.
 h.sqlite.prepare('UPDATE bill_items SET returned_quantity=1 WHERE id=?').run('i1');
 const pl2=await r.getProfitLossSummary('owner',f);
 assert.equal(only(pl2.totalRevenue,'revenue'),20000);assert.equal(only(pl2.totalCOGS,'cogs'),4000);assert.equal(pl2.netProfit,20000-4000-500);
 const perf=(await r.getProductPerformance('owner',f.startDate,f.endDate)).flatMap(g=>g.rows);
 assert.deepEqual(plain(perf.map(p=>({q:p.quantitySold,rev:p.revenue,profit:p.profit}))),[{q:1,rev:10000,profit:6000}]);

 // Dead stock: matched by stock id; a deleted bill is not a sale.
 h.insert('stock_items',{id:'s2',user_id:'owner',name_en:'Sugar',purchase_price:100,sale_price:200,quantity:5,created_at:'2026-01-01'});
 h.insert('bills',{id:'b9',user_id:'owner',bill_no:9,party_name:'Z',bill_date:'2026-09-20',subtotal:200,total:200,paid:0,due:200,status:'unpaid',is_draft:0,is_hold:0,is_deleted:1});
 h.insert('bill_items',{id:'i9',bill_id:'b9',item_id:'s2',item_name:'Sugar',quantity:1,unit_price:200,line_total:200});
 const afterDeleted=(await r.getProductPerformance('owner',f.startDate,f.endDate)).flatMap(g=>g.rows);
 assert.ok(!afterDeleted.some(p=>p.itemName==='Sugar'),'a deleted bill is not a sale');

 // Staff report: the DIRECT team only, real counts, dates bound in the right order.
 bill('bA',12000,{user_id:'staffA'});bill('bA2',5000,{user_id:'staffA',is_draft:1});bill('bSub',7000,{user_id:'subA'});
 h.insert('expenses',{id:'eA',user_id:'staffA',amount:100,description:'y',expense_date:'2026-09-11'});
 h.insert('expenses',{id:'eOld',user_id:'staffA',amount:100,description:'old',expense_date:'2026-08-11'});
 const sp=plain(await r.getStaffPerformance('owner',f));
 assert.deepEqual(sp.map(p=>p.staffId).sort(),['staffA','staffB','subA','subB'],'the admin sees their own staff, each once');
 const a=sp.find(p=>p.staffId==='staffA');
 assert.equal(only(a.salesGenerated,'salesGenerated'),12000);assert.equal(a.billsCreated,1);assert.equal(a.expensesAdded,1,'only expenses inside the range');
 // Two levels: a staff member has nobody reporting to them, so their staff report is empty.
 assert.deepEqual(plain(await r.getStaffPerformance('staffA',f)).map(p=>p.staffId),[],'a staff member has no team below them');
 h.insert('staff_records',{id:'srA',user_id:'owner',linked_user_id:'staffA',name_en:'Staff A',phone:'1',role:'x',status:'active',monthly_salary:0,joining_date:'2026-01-01'});
 // Another business's staff member, with attendance of their own: never ours to see.
 h.insert('staff_records',{id:'srOther',user_id:'otherOwner',linked_user_id:'otherStaff',name_en:'Other',phone:'2',role:'x',status:'active',monthly_salary:0,joining_date:'2026-01-01'});
 for(const [id,date,status] of [['at1','2026-09-02','present'],['at2','2026-09-03','absent'],['at3','2026-08-30','present']])
  h.insert('staff_attendance',{id,staff_id:'srA',date,status,clock_in:date+'T09:00:00Z'});
 h.insert('staff_attendance',{id:'atOther',staff_id:'srOther',date:'2026-09-02',status:'present',clock_in:'2026-09-02T09:00:00Z'});
 const att=plain(await r.getStaffAttendanceSummary('owner',f));
 assert.deepEqual(att.map(x=>x.staffId),['srA'],'attendance: the own team only, never another business');
 assert.equal(att[0].daysPresent,1);assert.equal(att[0].daysAbsent,1,'only days inside the range');

 // Exports carry rupees, never raw paisa; every report screen is on tokens, no charts in colours.
 // Every report the Reports tab offers can be exported, and none ships raw paisa.
 for(const f2 of ['SalesReportScreen','ProfitLossReportScreen','ExpenseReportScreen','CashFlowReportScreen','InventoryReportScreen','PartyReportScreen','StaffReportScreen']){
  const src=read('src/screens/reports/'+f2+'.tsx');
  assert.ok(/handleReportExport\(/.test(src),f2+' can be exported');
  assert.ok(!/metrics\.totalSales\]|i\.revenue\]|c\.totalSpend\]|s\.totalSales\]/.test(src),f2+' exports raw paisa');
  assert.ok(!/toISOString/.test(src),f2+' ranges are local days');
 }
 for(const file of fs.readdirSync(path.join(root,'src/screens/reports')).map(x=>'src/screens/reports/'+x).concat(['src/components/reports/DateFilterPicker.tsx','src/components/reports/ReportParts.tsx'])){
  const src=read(file);
  assert.equal((src.match(/#[0-9A-Fa-f]{3,8}\b/g)||[]).length,0,file+' has a hardcoded colour');
  assert.ok(!/className=|themeColors|gifted-charts/.test(src),file+' still on the old theme');
  assert.ok(!/fontWeight: '(bold|[6-9]00)'|uppercase/.test(src),file+' weight/caps');
 }
}));

check(121,"a staff member sees their OWN photo and documents: the admin writes them to staff_records, so the subject's login must resolve them through linked_user_id, not users.pictureUrl alone",at('src/services/database/staffDb.ts','getOwnStaffProfile'),()=>isolated(async h=>{
 const api=h.load('src/services/database/staffDb.ts');
 const photo=h.load('src/utils/customerPhoto.ts');
 // The admin and the staff login they created. The PROFILE is owned by the admin
 // (user_id) and points at the staff login (linked_user_id) — the two-row shape
 // managedAccountDb.createStaffMember writes.
 h.insert('users',{id:'owner',name:'Owner',role:'admin',parentId:null,account_level:'admin',phone:'03001110000',businessName:'B',passwordHash:'x'});
 h.insert('users',{id:'staffA',name:'Ahmed',role:'staff',parentId:'owner',account_level:'staff',phone:'03001112222',businessName:'B',passwordHash:'x'});
 const picked='file:///data/user/0/com.app/cache/ImagePicker/staff.jpg';
 const durable=await photo.persistStaffPhoto(picked,'sr_staffA');
 const doc=await photo.persistStaffDocument('file:///data/user/0/com.app/cache/DocumentPicker/cnic.pdf','sr_staffA');
 h.insert('staff_records',{id:'sr_staffA',user_id:'owner',linked_user_id:'staffA',name_en:'Ahmed',phone:'03001112222',role:'Sales',joining_date:'2026-09-01',area:'Quetta',status:'active',photo_local_path:durable,document_urls:JSON.stringify([doc]),is_deleted:0});

 // 1. The admin's view — unchanged, and the control for the assertion below.
 const asAdmin=(await api.getStaffRecords('owner')).find(s=>s.id==='sr_staffA');
 assert.ok(asAdmin,'the admin lists the staff member they added');
 assert.equal(api.staffPhotoUri(asAdmin),durable,'the admin resolves the photo');

 // 2. The subject's own view — THE BUG. Every other read scopes by user_id, which is
 //    the ADMIN here, so none of them return this row to staffA.
 assert.ok(!(await api.getStaffRecords('staffA')).some(s=>s.id==='sr_staffA'),'user_id scoping cannot reach it — this is why the photo went missing');
 const own=await api.getOwnStaffProfile('staffA');
 assert.ok(own,'the subject reaches their own profile through linked_user_id');
 assert.equal(own.id,'sr_staffA');
 // users.pictureUrl is NULL for an admin-created account: resolution must still succeed.
 assert.equal(api.accountPhotoUri(null,own),durable,'the subject resolves the SAME photo the admin sees');
 assert.equal(api.accountPhotoUri(undefined,own),durable,'an absent pictureUrl is not a missing photo');

 // 3. Own picture wins once set, and neither column is copied into the other.
 const mine='test://profile_photos/mine.jpg';
 assert.equal(api.accountPhotoUri(mine,own),mine,"the account's own picture overrides the admin's");
 assert.equal(own.photo_local_path,durable,"setting one's own picture never rewrites the admin's column");
 assert.equal(api.accountPhotoUri(null,null),null,'no photo anywhere falls through to the initial');
 assert.equal(api.accountPhotoUri('',null),null,'blank is not a photo');
 // Remote still wins over the local copy, same order as staffPhotoUri/customerPhotoUri.
 assert.equal(api.accountPhotoUri(null,{photo_remote_url:'https://x/1.jpg',photo_local_path:durable}),'https://x/1.jpg');

 // 4. Documents: same root cause, same fix — the subject reads their own.
 // Compared element-wise, not deepEqual: the array is JSON.parsed inside the module
 // sandbox, so it carries that realm's Array.prototype and deepStrictEqual rejects it.
 assert.equal(own.document_urls.length,1,'the subject sees the documents the admin attached');
 assert.equal(own.document_urls[0],doc,'and it is the same durable path');
 assert.ok(durable.startsWith('test://staff_photos/')&&doc.startsWith('test://staff_docs/'),'both live under documentDirectory, which every account on the device shares');

 // 5. An admin has no staff profile, and a sub-staff record has no login to match.
 assert.equal(await api.getOwnStaffProfile('owner'),null,'an admin has no staff profile — the section stays hidden');
 h.insert('staff_records',{id:'sr_sub',user_id:'staffA',linked_user_id:null,name_en:'Helper',phone:'03001113333',role:'Helper',joining_date:'2026-09-01',area:'Quetta',status:'active',is_deleted:0});
 assert.equal(await api.getOwnStaffProfile(''),null,'no id is not a lookup');
 assert.equal((await api.getOwnStaffProfile('staffA')).id,'sr_staffA','a no-login sub-staff row never matches somebody else');
 // A removed profile stops resolving.
 h.sqlite.prepare("UPDATE staff_records SET is_deleted=1 WHERE id='sr_staffA'").run();
 assert.equal(await api.getOwnStaffProfile('staffA'),null,'a deleted profile is not read');

 // 6. The screen actually uses it — a resolver nothing calls would not fix the bug.
 const s=read('src/screens/staff/SettingsScreen.tsx');
 assert.ok(/getOwnStaffProfile\(/.test(s),'Settings loads the own staff profile');
 assert.ok(/accountPhotoUri\(/.test(s),'Settings resolves the avatar through the join');
 assert.ok(!/uri:\s*user\.pictureUrl\s*\}/.test(s),'Settings no longer renders users.pictureUrl alone');
 assert.ok(/openAttachment\(doc\)/.test(s)&&/\{attachmentViewer\}/.test(s),'documents open through the shared viewer');
 assert.equal((s.match(/#[0-9A-Fa-f]{3,8}\b/g)||[]).length,0,'SettingsScreen has a hardcoded colour');
 assert.ok(/minHeight:\s*touchTarget/.test(s),'document rows keep a 44dp touch target');
}));

check(122,'nothing shadows the translator: a local named `t` hides useLanguageStore\'s t, and the next person to translate a label in that scope ships a crash (Purchase Book day header called t(\'billTotal\') on a totals object)',at('src/screens/PurchaseBook/PurchaseBookScreen.tsx','dayHeader'),()=>{
 // Pure source check: the suites never mount React, and this failure only appears
 // while a row renders. `t` is `any` at every one of these sites, so tsc passes too —
 // the type system cannot see it and neither can a DB test.
 const offenders=[];
 for(const p of sourceFiles().filter(f=>/\.tsx$/.test(f))){
  const src=fs.readFileSync(p,'utf8');
  // Only files that actually have a translator in scope can shadow one.
  if(!/useLanguageStore/.test(src))continue;
  const rel=path.relative(root,p).replace(/\\/g,'/');
  const decl=/(^|[^\w.])(?:const|let|var)\s+t\s*=/g;
  let m;
  while((m=decl.exec(src))!==null){
   // `const t = useLanguageStore(s => s.t)` IS the translator — the selector form of the
   // same binding as `const { t } = useLanguageStore()`, not a shadow of it.
   if(/useLanguageStore|\bs\.t\b|getState\(\)\.t/.test(src.slice(m.index,src.indexOf('\n',m.index)+1||src.length)))continue;
   // Walk to the end of the block this declaration sits in, so a later sibling scope
   // (a catch block, the next function) is not blamed for it.
   let depth=0,end=src.length;
   for(let i=m.index+m[0].length;i<src.length;i++){
    const c=src[i];
    if(c==='{')depth++;
    else if(c==='}'){if(depth===0){end=i;break;}depth--;}
   }
   const line=src.slice(0,m.index).split('\n').length;
   offenders.push(rel+':'+line+(/\bt\(/.test(src.slice(m.index,end))?' — and CALLS t(…) in that scope: this is the crash':' — latent: translating any label in that scope crashes it'));
  }
 }
 assert.deepEqual(offenders,[],'translator shadowed:\n  '+offenders.join('\n  '));
});

check(123,'multi-currency step 1: v41 puts a currency on the entry roots only, every existing row is PKR, and the money layer still divides by exactly 100',at(dbPath,'version < 41'),()=>isolated(async h=>{
 const ROOTS=['bills','expenses','purchase_orders','purchase_invoices'];
 // Rows written BEFORE the migration must come out as PKR, not null — that is the
 // whole claim of "these books have only ever held rupees". isolated(..., 40) boots the
 // fixture at v40, so these rows predate the column.
 for(const table of ROOTS)assert.ok(!h.all('PRAGMA table_info('+table+')').some(c=>c.name==='currency'),table+' had a currency before v41');
 const before=Object.fromEntries(ROOTS.map(table=>[table,h.insert(table,{id:table+'_pre41'})]));
 h.insert('users',{id:'pre41',name:'Pre',role:'admin',parentId:null,phone:'03009990041',businessName:'B',passwordHash:'x'});
 await h.boot();
 assert.equal(h.one('PRAGMA user_version').user_version,latest);
 for(const table of ROOTS){
  const col=h.all('PRAGMA table_info('+table+')').find(c=>c.name==='currency');
  assert.ok(col,table+' has no currency column');
  assert.equal(col.notnull,1,table+'.currency is nullable');
  assert.equal(col.dflt_value,"'PKR'",table+'.currency has the wrong default');
  assert.equal(h.one('SELECT currency AS c FROM '+table+' WHERE id=?',before[table]).c,'PKR',table+' row from v40 is not PKR');
  // A row inserted now, naming no currency, is PKR too.
  assert.equal(h.one('SELECT currency AS c FROM '+table+' WHERE id=?',h.insert(table,{id:table+'_post41'})).c,'PKR',table+' default not applied');
 }
 const uc=h.all('PRAGMA table_info(users)').find(c=>c.name==='default_currency');
 assert.ok(uc&&uc.notnull===1&&uc.dflt_value==="'PKR'",'users.default_currency is missing or not NOT NULL DEFAULT PKR');
 assert.equal(h.one("SELECT default_currency AS c FROM users WHERE id='pre41'").c,'PKR','an account from v40 is not PKR');
 // Khata and cashbook deliberately have none: khata has no currency picker, and what
 // a khata entry is denominated in for a non-PKR account is still an open question.
 for(const table of ['transactions','cashbook'])
  assert.ok(!h.all('PRAGMA table_info('+table+')').some(c=>c.name==='currency'),table+' grew a currency column that nothing decided');
 // A line item inherits its document's currency; a second copy could disagree with it.
 for(const table of ['bill_items','purchase_invoice_items','purchase_order_items','supplier_payments','purchase_returns'])
  assert.ok(!h.all('PRAGMA table_info('+table+')').some(c=>c.name==='currency'),table+' stores a currency that can drift from its parent');

 // The converters and the table must agree: every supported currency has 100 minor
 // units, which is the only reason one hardcoded /100 can serve all of them.
 const {CURRENCIES,CURRENCY_CODES,resolveCurrency}=h.load('src/utils/currency.ts');
 const c=calc(h);
 for(const code of CURRENCY_CODES){
  assert.equal(CURRENCIES[code].minorUnits,100,code+' would break rupeesToPaisa/paisaToRupees');
  assert.equal(c.paisaToRupees(123456)*CURRENCIES[code].minorUnits,123456,code);
 }
 assert.equal(c.rupeesToPaisa('1234.56'),123456);
 assert.equal(c.paisaToRupeesString(123456),'1234.56');
 assert.equal(resolveCurrency('KWD').code,'PKR','KWD must not resolve: it has 1000 minor units');
 assert.equal(c.formatCurrency(123456),'Rs. 1,234.56','the default output is unchanged');
 assert.equal(c.formatCurrency(123456,'USD'),'USD 1,234.56');
 assert.equal(c.formatSignedCurrency(-123456,'USD'),'\u2212USD 1,234.56','an export keeps the minus in every currency');
 // Nothing writes a currency yet — step 1 is the foundation only.
 const writers=sourceFiles().filter(f=>/INSERT INTO (bills|expenses|purchase_orders|purchase_invoices)[^;]*currency/i.test(fs.readFileSync(f,'utf8')));
 assert.deepEqual(writers,[],'a screen already writes a currency: that is step 2/3, not step 1');
},40));

check(124,'every image a screen require()s really is the format its extension claims: Android resource compilation (AAPT2) rejects a JPEG named .png and the whole release build fails',at('src/screens/auth/LoginScreen.tsx','assets/favicon.png'),()=>{
 // Metro copies a require()d image into android/res/drawable-* VERBATIM, and AAPT2 then
 // compiles it by extension. A JPEG called .png fails there with "file failed to compile",
 // which surfaces only as "Gradle build failed with unknown error" on EAS. The app.json
 // icon/splash/adaptiveIcon fields do NOT have this problem — Expo re-encodes those by
 // content — so only images reached from JS are checked here.
 const MAGIC={
  png:b=>b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47,
  jpg:b=>b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF,
  jpeg:b=>b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF,
  gif:b=>b.toString('latin1',0,3)==='GIF',
  webp:b=>b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WEBP',
 };
 const actual=b=>Object.keys(MAGIC).find(k=>MAGIC[k](b))||'unknown';
 const offenders=[];
 let checked=0;
 for(const file of sourceFiles()){
  const text=fs.readFileSync(file,'utf8');
  for(const m of text.matchAll(/require\(\s*['"]([^'"]+\.(png|jpe?g|gif|webp))['"]\s*\)/gi)){
   const asset=path.resolve(path.dirname(file),m[1]);
   const where=file.slice(root.length+1)+' -> '+m[1];
   if(!fs.existsSync(asset)){offenders.push(where+' : file does not exist');continue;}
   checked++;
   const ext=m[2].toLowerCase();
   const buf=fs.readFileSync(asset);
   if(!MAGIC[ext](buf))offenders.push(where+' : extension says '+ext+' but the bytes are '+actual(buf));
  }
 }
 assert.ok(checked>0,'the scanner matched no require()d images — the pattern has rotted');
 assert.deepEqual(offenders,[],'an image will not survive Android resource compilation:\n  '+offenders.join('\n  '));
});

check(125,'nothing a person can see still says DigiKhata or Zakir: the dictionaries, every export document, the seed and the Expo app name carry the AL-REEF brand only',at('app.config.js','name:'),()=>{
 // Scanned surfaces are the ones a PERSON reaches: the two dictionaries, the four files
 // that build an exported PDF/CSV, the seed rows that become a displayed name and a
 // document heading, and the Expo config whose `name` is the Android launcher label.
 const SURFACES=[
  'src/i18n/en.ts','src/i18n/ur.ts',
  'src/utils/pdfGenerator.ts','src/components/Download/reportTemplates.ts',
  'src/components/Download/csvGenerator.ts','src/screens/BillBook/BillDetailScreen.tsx',
  'src/services/database/seedData.ts','app.config.js','app.json',
 ];
 // Only two identifiers may keep the old name, because renaming them breaks something
 // concrete: slug and projectId bind the EAS project, its build history and the install
 // links already handed out. The Android package and iOS bundle id are NOT in this
 // allowance — they were renamed to com.alreef.app on 2026-10-03, before the client
 // installed anything, and are pinned below so the old name cannot return there.
 const ALLOWED=/^\s*(slug|projectId)\b|"(slug|projectId)"\s*:/;
 const BRAND=/digi\s*[-_]?\s*khata|zakir/i;
 const offenders=[];
 for(const rel of SURFACES){
  const text=read(rel);
  text.split('\n').forEach((line,i)=>{
   if(!BRAND.test(line))return;
   if(ALLOWED.test(line))return;
   offenders.push(rel+':'+(i+1)+'  '+line.trim().slice(0,90));
  });
 }
 assert.deepEqual(offenders,[],'an old brand name is still reachable by a user:\n  '+offenders.join('\n  '));

 // The brand that SHOULD be there, so this check fails if a rename empties them instead.
 assert.match(read('app.config.js'),/name:\s*"AL-REEF"/,'the Android launcher label is not AL-REEF');
 assert.match(read('src/screens/auth/LoginScreen.tsx'),/>AL-REEF</,'the login screen no longer shows AL-REEF');
 for(const rel of ['src/utils/pdfGenerator.ts','src/components/Download/reportTemplates.ts','src/screens/BillBook/BillDetailScreen.tsx'])
  assert.match(read(rel),/Generated by AL-REEF/,rel+' does not sign its exports AL-REEF');

 // The app's identity on the device. Renaming this AFTER a client installs makes Android
 // treat it as a different app: no upgrade path, and their ledger becomes unreachable.
 // Changed once, before first distribution. It must not move again.
 const cfg=read('app.config.js');
 assert.match(cfg,/package: "com\.alreef\.app"/,"the Android package changed");
 assert.match(cfg,/bundleIdentifier: "com\.alreef\.app"/,"the iOS bundle id changed");
 for(const re of [/package: "([^"]+)"/,/bundleIdentifier: "([^"]+)"/]){
  const got=re.exec(cfg)[1];
  assert.ok(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(got),"not a legal package name (no hyphens, no capitals): "+got);
 }

 // The database filename must NOT be rebranded: renaming it opens a new, empty database
 // and orphans every existing row on the device. It is invisible to users by design.
 assert.match(read('src/services/database/db.ts'),/DB_NAME = 'digikhata_v3\.db'/,'the database filename was renamed — existing ledgers would become unreachable');
});

check(126,'multi-currency step 2: a new account takes its default currency from its phone as a SUGGESTION, unlisted and 1000-minor-unit countries fall back to PKR, and the admin can change it on the form and afterwards',at('src/utils/currency.ts','currencyFromPhone'),()=>isolated(async h=>{
 const {currencyFromPhone,CURRENCY_CODES}=h.load('src/utils/currency.ts');
 // THE PROPERTY: the suggestion follows the number's COUNTRY, in every shape the field
 // accepts — not just the one shape a form happens to produce.
 const BY_COUNTRY=[
  ['Pakistan','92','3001234567','PKR'], ['UAE','971','501234567','AED'],
  ['China','86','13800138000','CNY'],   ['USA','1','5551234567','USD'],
 ];
 for(const [where,cc,nat,want] of BY_COUNTRY){
  const local=cc==='92'?'0'+nat:'0'+cc+nat;
  for(const typed of [local,'+'+cc+' '+nat,'00'+cc+nat,cc+nat])
   assert.equal(currencyFromPhone(typed),want,where+' typed as '+typed);
 }
 // Unlisted countries, and the ones deliberately excluded, are PKR with the picker shown.
 // KWD/BHD/OMR have 1000 minor units and cannot be added without changing the converters.
 for(const [where,typed] of [['Saudi Arabia','+966501234567'],['Kuwait','+96550123456'],
   ['Bahrain','+97312345678'],['Oman','+96892123456'],['UK','+447911123456'],['India','+919812345678']])
  assert.equal(currencyFromPhone(typed),'PKR',where+' must fall back to PKR');
 for(const junk of ['',null,undefined,'abc','0','+']) assert.equal(currencyFromPhone(junk),'PKR','not a number: '+String(junk));

 // A new staff account stores the suggestion, and it is only ever a SUGGESTION: the form
 // passes whatever the admin left in the picker, so a Pakistani number can be AED.
 seedPeople(h);h.login('owner');
 const api=h.load('src/services/database/managedAccountDb.ts');
 const form=(name,phone,extra={})=>({name_en:name,phone,password:'FixturePass1',role:'Driver',
   joining_date:'2026-09-01',area:'Dubai',business_type:'Retail',...extra});
 const dubai=await api.createStaffMember(form('Dubai Hand','+971501112233',{default_currency:'AED'}));
 assert.equal(h.one('SELECT default_currency AS c FROM users WHERE id=?',dubai.user.id).c,'AED');
 // Pakistani number, admin chose AED anyway — the number must not override the choice.
 const posted=await api.createStaffMember(form('Posted Abroad','03211112233',{default_currency:'AED'}));
 assert.equal(h.one('SELECT default_currency AS c FROM users WHERE id=?',posted.user.id).c,'AED','the phone overrode the admin');
 // Caller that names no currency keeps working and lands on PKR.
 const plainStaff=await api.createStaffMember(form('No Currency','03211112244'));
 assert.equal(h.one('SELECT default_currency AS c FROM users WHERE id=?',plainStaff.user.id).c,'PKR');
 // An unsupported code never reaches the column.
 const junkStaff=await api.createStaffMember(form('Junk','03211112255',{default_currency:'KWD'}));
 assert.equal(h.one('SELECT default_currency AS c FROM users WHERE id=?',junkStaff.user.id).c,'PKR','KWD was stored');

 // Editable afterwards, on the login row, without touching staff_records.
 await api.updateStaffProfile(dubai.staff.id,{default_currency:'USD'});
 assert.equal(h.one('SELECT default_currency AS c FROM users WHERE id=?',dubai.user.id).c,'USD');
 assert.ok(!h.all('PRAGMA table_info(staff_records)').some(c=>c.name==='default_currency'),'currency leaked onto staff_records');
 await assert.rejects(api.updateStaffProfile(dubai.staff.id,{default_currency:'KWD'}),/supported currency/);
 assert.equal(h.one('SELECT default_currency AS c FROM users WHERE id=?',dubai.user.id).c,'USD','a refused edit changed it anyway');
 // Editing something else must not disturb the currency.
 await api.updateStaffProfile(dubai.staff.id,{role:'Manager'});
 assert.equal(h.one('SELECT default_currency AS c FROM users WHERE id=?',dubai.user.id).c,'USD');
 const staffApi=h.load('src/services/database/staffDb.ts');
 assert.equal(await staffApi.getAccountCurrency(dubai.user.id),'USD');
 assert.equal(await staffApi.getAccountCurrency(null),'PKR','a profile with no login has no currency');

 // The form must offer every supported currency, and the dial codes that suggest them.
 const picker=read('src/components/CountryCodePicker.tsx');
 for(const dial of ['+92','+971','+86','+1']) assert.ok(picker.includes("'"+dial+"'"),'CountryCodePicker cannot reach '+dial);
 const add=read('src/screens/StaffBook/AddStaffModal.tsx');
 assert.ok(/<CountryCodePicker/.test(add),'Add Staff still has a free-text phone with no dial code');
 assert.ok(/<CurrencyPicker/.test(add)&&/currencyFromPhone\(/.test(add),'Add Staff does not suggest a currency');
 assert.ok(/currencyTouched/.test(add),'the suggestion would overwrite the admin\u2019s own choice');
 assert.ok(/<CurrencyPicker/.test(read('src/screens/StaffBook/StaffDetail.tsx')),'the profile cannot change the currency afterwards');
 for(const code of CURRENCY_CODES) assert.ok(read('src/components/ui/CurrencyPicker.tsx').includes(code),code+' is missing from the picker');
}));

check(127,'multi-currency step 3 (Purchase): an order or invoice is stored in the currency it was entered in, reads back in that currency everywhere, is never converted, and with no explicit choice takes the ACCOUNT default rather than a hardcoded PKR',at('src/services/database/purchaseDb.ts','accountDefaultCurrency'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const pur=h.load('src/services/database/purchaseDb.ts');
 const calcApi=calc(h);
 h.insert('suppliers',{id:'sup1',user_id:'owner',name:'Gulf Trading'});
 const line=(cost,qty)=>[{stock_item_id:null,item_name:'Pipe',quantity:qty,unit_cost:cost,line_total:cost*qty}];

 // Entered in USD -> stored USD, and the stored figure is untouched integer minor units.
 const usdPo=await pur.createPurchaseOrder('owner','sup1',line(50000,2),'2026-09-10',undefined,undefined,'USD');
 const poRow=h.one("SELECT currency,total FROM purchase_orders WHERE id=?",usdPo.id);
 assert.equal(poRow.currency,'USD');
 assert.equal(poRow.total,100000,'the amount was converted — it must be stored exactly as entered');

 // It reads back in USD through the SAME query the screens use, not relabelled.
 const listed=(await pur.getPurchaseOrders('owner')).find(o=>o.id===usdPo.id);
 assert.equal(listed.currency,'USD','the list row lost the currency');
 const detail=await pur.getPurchaseOrderById(usdPo.id);
 assert.equal(detail.currency,'USD','the detail screen lost the currency');
 assert.equal(detail.total,100000,'the detail screen converted the figure');
 // What the user actually sees, formatted once with the entry's own currency.
 assert.equal(calcApi.formatCurrency(detail.total,detail.currency),'USD 1,000');
 assert.notEqual(calcApi.formatCurrency(detail.total,detail.currency),calcApi.formatCurrency(detail.total),'USD and PKR render identically — the currency is being ignored');

 // Same for an invoice, including its derived figures.
 const aedInv=await pur.createPurchaseInvoice('owner','sup1',line(25000,4),'2026-09-11',{currency:'AED',taxAmount:5000});
 const invRow=h.one("SELECT currency,total,balance_due FROM purchase_invoices WHERE id=?",aedInv.id);
 assert.equal(invRow.currency,'AED');
 assert.equal(invRow.total,105000,'subtotal+tax changed with the currency');
 assert.equal(invRow.balance_due,105000);
 const invBack=await pur.getPurchaseInvoiceById(aedInv.id);
 assert.equal(invBack.currency,'AED');
 assert.equal(calcApi.formatCurrency(invBack.balance_due,invBack.currency),'AED 1,050');

 // NO explicit choice -> the ACCOUNT default, not a hardcoded PKR. This is the case a
 // hardcoded fallback would silently get wrong for a Dubai shop.
 h.sqlite.prepare("UPDATE users SET default_currency='AED' WHERE id='owner'").run();
 const implicitPo=await pur.createPurchaseOrder('owner','sup1',line(10000,1),'2026-09-12');
 assert.equal(h.one("SELECT currency AS c FROM purchase_orders WHERE id=?",implicitPo.id).c,'AED','an unspecified currency ignored the account default');
 const implicitInv=await pur.createPurchaseInvoice('owner','sup1',line(10000,1),'2026-09-12',{});
 assert.equal(h.one("SELECT currency AS c FROM purchase_invoices WHERE id=?",implicitInv.id).c,'AED');
 // An unsupported code never reaches the column.
 const junkPo=await pur.createPurchaseOrder('owner','sup1',line(10000,1),'2026-09-12',undefined,undefined,'KWD');
 assert.equal(h.one("SELECT currency AS c FROM purchase_orders WHERE id=?",junkPo.id).c,'PKR','KWD was stored');

 // Two currencies coexist without one rewriting the other.
 assert.equal(h.one("SELECT currency AS c FROM purchase_orders WHERE id=?",usdPo.id).c,'USD','a later entry changed an earlier one');

 // ── The screens must pass each document's OWN currency, not the account's ──────
 const EVERY=[
  ['src/screens/PurchaseBook/PurchaseBookScreen.tsx','item.currency'],
  ['src/screens/PurchaseBook/PurchaseOrderDetailScreen.tsx','order.currency'],
  ['src/screens/PurchaseBook/PurchaseInvoiceScreen.tsx','invoice.currency'],
 ];
 for(const [f,expr] of EVERY) assert.ok(read(f).includes('currency={'+expr+'}'),f+' does not render its own currency');
 // A receipt and a return are figures OF a document, so its currency travels with them.
 assert.ok(/currency: order\.currency/.test(read('src/screens/PurchaseBook/PurchaseOrderDetailScreen.tsx')),'Receive goods is not told the order currency');
 assert.ok(/currency: invoice\.currency/.test(read('src/screens/PurchaseBook/PurchaseInvoiceScreen.tsx')),'Purchase return is not told the invoice currency');

 // The chip opens on the ACCOUNT DEFAULT every time — never the last currency used.
 for(const f of ['src/screens/PurchaseBook/CreatePurchaseOrderModal.tsx','src/screens/PurchaseBook/CreatePurchaseInvoiceModal.tsx']){
  const src=read(f);
  assert.ok(/<CurrencyPicker/.test(src),f+' has no currency picker');
  assert.ok(/useState<CurrencyCode>\(accountCurrency\)/.test(src),f+' does not open on the account default');
  assert.ok(/resolveCurrency\(user\?\.defaultCurrency\)/.test(src),f+' does not read the account default');
  assert.ok(!/AsyncStorage|lastCurrency|rememberCurrency/.test(src),f+' remembers the last currency — a rupee bill saved as CNY is the whole risk');
  assert.ok(/currencyEntryHint/.test(src),f+' is missing the "this entry only" hint');
 }
 // The session must actually carry the default, or every chip above opens on PKR.
 const u=users(h);
 await u.createUser('Dubai Owner','03451112222','FixturePass1','admin','admin','Shop',undefined,undefined,undefined,undefined,undefined,'AED');
 assert.equal((await u.verifyUserLogin('03451112222','FixturePass1')).defaultCurrency,'AED','the signed-in user does not carry the account default');
}));

check(128,'multi-currency step 3 (Bill and Expense): each entry is stored and read back in the currency it was entered in — on the row, the detail screen and the printed invoice — never converted, and with no explicit choice it takes the ACCOUNT default',at('src/services/database/billDb.ts','currencyRow'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const bills=h.load('src/services/database/billDb.ts');
 const exp=h.load('src/services/database/expenseDb.ts');
 const calcApi=calc(h);

 // ── Bill ───────────────────────────────────────────────────────────────────
 const mkBill=(total,extra={})=>bills.createBill({
   user_id:'owner',customer_id:'walk_in',party_name:'Walk-in Customer',bill_date:'2026-09-10',
   subtotal:total,discount_pct:0,discount_amount:0,tax_amount:0,total,paid:0,
   payment_method:'cash',is_draft:0,is_hold:0,...extra,
 },[{item_name:'Pipe',quantity:1,unit_price:total,line_total:total}]);

 const usd=await mkBill(100000,{currency:'USD'});
 assert.equal(h.one('SELECT currency AS c FROM bills WHERE id=?',usd.id).c,'USD');
 assert.equal(h.one('SELECT total AS t FROM bills WHERE id=?',usd.id).t,100000,'the amount was converted');
 assert.equal(calcApi.formatCurrency(100000,'USD'),'USD 1,000');

 // No explicit choice -> the ACCOUNT default, not a hardcoded PKR.
 h.sqlite.prepare("UPDATE users SET default_currency='AED' WHERE id='owner'").run();
 const implicit=await mkBill(50000);
 assert.equal(h.one('SELECT currency AS c FROM bills WHERE id=?',implicit.id).c,'AED','a bill ignored the account default');
 // An unsupported code never reaches the column.
 const junk=await mkBill(50000,{currency:'KWD'});
 assert.equal(h.one('SELECT currency AS c FROM bills WHERE id=?',junk.id).c,'PKR','KWD was stored');
 // One entry never rewrites another.
 assert.equal(h.one('SELECT currency AS c FROM bills WHERE id=?',usd.id).c,'USD');

 // ── Expense ────────────────────────────────────────────────────────────────
 const mkExp=(amount,extra={})=>exp.addExpenseRecord({
   user_id:'owner',amount,description:'Fuel',expense_date:'2026-09-10',...extra,
 });
 const eUsd=await mkExp(30000,{currency:'USD'});
 assert.equal(h.one('SELECT currency AS c FROM expenses WHERE id=?',eUsd.id).c,'USD');
 assert.equal(h.one('SELECT amount AS a FROM expenses WHERE id=?',eUsd.id).a,30000,'the amount was converted');
 const eImplicit=await mkExp(20000);
 assert.equal(h.one('SELECT currency AS c FROM expenses WHERE id=?',eImplicit.id).c,'AED','an expense ignored the account default');
 // Editing may change it, and an unsupported code is refused at the column.
 await exp.updateExpenseRecord(eUsd.id,'owner',{currency:'CNY'});
 assert.equal(h.one('SELECT currency AS c FROM expenses WHERE id=?',eUsd.id).c,'CNY');
 await exp.updateExpenseRecord(eUsd.id,'owner',{currency:'KWD'});
 assert.equal(h.one('SELECT currency AS c FROM expenses WHERE id=?',eUsd.id).c,'PKR','KWD survived an edit');
 // Editing something else must not disturb the currency.
 await exp.updateExpenseRecord(eImplicit.id,'owner',{description:'Diesel'});
 assert.equal(h.one('SELECT currency AS c FROM expenses WHERE id=?',eImplicit.id).c,'AED');

 // ── Every screen renders the ENTRY's own currency, including the printed bill ──
 const detail=read('src/screens/BillBook/BillDetailScreen.tsx');
 for(const f of ['bill.subtotal','bill.total','bill.paid','bill.due','item.unit_price','item.line_total'])
  assert.ok(detail.includes(f+', bill.currency)')||detail.includes('paisa={'+f+'}')&&new RegExp('paisa=\{'+f.replace('.','\.')+'\}[^/>]*currency=\{bill\.currency\}').test(detail),
   'bill detail renders '+f+' without its currency');
 // The INVOICE PDF is handed to customers — it must print the currency it was billed in.
 const invoiceHtml=detail.slice(detail.indexOf('<!DOCTYPE'),detail.indexOf('</html>'));
 assert.ok(invoiceHtml.length>0,'could not find the invoice template');
 const bare=[...invoiceHtml.matchAll(/formatCurrency\(([^),]+)\)/g)].map(m=>m[1]);
 assert.deepEqual(bare,[],'the printed invoice formats these without a currency: '+bare.join(', '));
 assert.ok(/currency=\{item\.currency\}/.test(read('src/screens/BillBook/BillBookScreen.tsx')),'a bill row ignores its currency');
 assert.ok(/currency=\{item\.currency\}/.test(read('src/screens/ExpenseBook/ExpenseBookScreen.tsx')),'an expense row ignores its currency');
 assert.ok(/currency=\{expense\.currency\}/.test(read('src/screens/ExpenseBook/ExpenseDetail.tsx')),'the expense detail ignores its currency');

 // The chip opens on the account default, and on an EDIT on what was actually saved,
 // so re-saving an expense can never silently relabel it.
 const addExp=read('src/screens/ExpenseBook/AddExpenseModal.tsx');
 assert.ok(/<CurrencyPicker/.test(addExp)&&!/rsPrefix/.test(addExp),'the expense amount still shows a hardcoded Rs');
 assert.ok(/isEdit \? resolveCurrency\(editing\?\.currency\)/.test(addExp),'editing an expense would relabel its currency');
 for(const f of ['src/screens/BillBook/CreateNewBillModal.tsx','src/screens/ExpenseBook/AddExpenseModal.tsx']){
  assert.ok(/<CurrencyPicker/.test(read(f)),f+' has no picker');
  assert.ok(!/AsyncStorage|lastCurrency|rememberCurrency/.test(read(f)),f+' remembers the last currency');
 }
}));

check(129,'multi-currency step 4: every book total is ONE FIGURE PER CURRENCY from SQL — a mixed range never collapses to a summed number, a single-currency range is unchanged, and the lines keep a fixed order at any page count',at('src/utils/currencyTotals.ts','totalsFrom'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const T=h.load('src/utils/currencyTotals.ts');
 const calcApi=calc(h);
 const bills=h.load('src/services/database/billDb.ts');
 const exp=h.load('src/services/database/expenseDb.ts');
 const pur=h.load('src/services/database/purchaseDb.ts');

 // Ordering is FIXED: account default first, then alphabetical. Two renders of the same
 // data must stack identically, whatever order the rows arrived in.
 const shuffled=[{currency:'USD',t:3},{currency:'AED',t:2},{currency:'CNY',t:4},{currency:'PKR',t:1}];
 assert.deepEqual(plain(T.totalsFrom(shuffled,'t','PKR').map(x=>x.currency)),['PKR','AED','CNY','USD']);
 assert.deepEqual(plain(T.totalsFrom([...shuffled].reverse(),'t','PKR').map(x=>x.currency)),['PKR','AED','CNY','USD'],'the order depends on row order');
 assert.deepEqual(plain(T.totalsFrom(shuffled,'t','AED').map(x=>x.currency)),['AED','CNY','PKR','USD'],'the account default must lead');
 assert.deepEqual(plain(T.totalsFrom([{currency:'PKR',t:5},{currency:'USD',t:0}],'t','PKR')),[{currency:'PKR',amount:5}]);
 assert.deepEqual(plain(T.totalsFrom([],'t','AED')),[{currency:'AED',amount:0}]);

 // A MIXED range must never produce one summed figure.
 const day='2026-09-10';
 const mkBill=(total,currency)=>bills.createBill({user_id:'owner',customer_id:'walk_in',party_name:'W',bill_date:day,
   subtotal:total,discount_pct:0,discount_amount:0,tax_amount:0,total,paid:0,payment_method:'cash',is_draft:0,is_hold:0,currency},
   [{item_name:'X',quantity:1,unit_price:total,line_total:total}]);
 await mkBill(10000,'PKR'); await mkBill(20000,'PKR'); await mkBill(30000,'USD');

 const summaryAll=(await bills.getFilteredBills('owner',{status:'all'})).billSummary;
 assert.ok(Array.isArray(summaryAll.totalBilled),'the bill total was flattened back to a scalar');
 assert.deepEqual(plain(summaryAll.totalBilled),[{currency:'PKR',amount:30000},{currency:'USD',amount:30000}]);
 assert.notDeepEqual(plain(summaryAll.totalBilled),[{currency:'PKR',amount:60000}],'PKR and USD were summed together');
 assert.equal(summaryAll.totalBilled.length,2,'a mixed range must render two lines');
 const dayRows=await bills.getBillDayTotals('owner',{status:'all'});
 const theDay=dayRows.find(d=>d.day===day);
 assert.deepEqual(plain(theDay.totalBilled),[{currency:'PKR',amount:30000},{currency:'USD',amount:30000}]);
 assert.equal(theDay.billCount,3,'the count still covers every currency');

 // A single-currency figure is exactly what it always was, and soleTotal refuses a
 // mixed one rather than handing back a partial number.
 assert.equal(T.isMixed(theDay.totalPaid),false,'nothing was paid, so that total is one line');
 const paid=T.soleTotal(theDay.totalPaid);
 assert.equal(calcApi.formatCurrency(paid.amount,paid.currency),'Rs. 0');
 assert.equal(T.soleTotal(theDay.totalBilled),null,'soleTotal must refuse a mixed total');

 // Expense and Purchase group the same way.
 await exp.addExpenseRecord({user_id:'owner',amount:4000,description:'A',expense_date:day,currency:'PKR'});
 await exp.addExpenseRecord({user_id:'owner',amount:5000,description:'B',expense_date:day,currency:'AED'});
 const expenseSummary=(await exp.getFilteredExpenses('owner',{})).expenseSummary;
 assert.deepEqual(plain(expenseSummary.totalExpense),[{currency:'PKR',amount:4000},{currency:'AED',amount:5000}]);
 const expDay=(await exp.getExpenseDayTotals('owner',{})).find(d=>d.day===day);
 assert.deepEqual(plain(expDay.totalExpense),[{currency:'PKR',amount:4000},{currency:'AED',amount:5000}]);
 assert.equal(expDay.entryCount,2);

 h.insert('suppliers',{id:'sup1',user_id:'owner',name:'S'});
 const li=c=>[{stock_item_id:null,item_name:'P',quantity:1,unit_cost:c,line_total:c}];
 await pur.createPurchaseOrder('owner','sup1',li(7000),day,undefined,undefined,'PKR');
 await pur.createPurchaseOrder('owner','sup1',li(8000),day,undefined,undefined,'CNY');
 const poDay=(await pur.getPurchaseOrderDayTotals('owner',{})).find(d=>d.day===day);
 assert.deepEqual(plain(poDay.total),[{currency:'PKR',amount:7000},{currency:'CNY',amount:8000}]);
 assert.equal(poDay.count,2);
 const sum=await pur.getPurchaseSummary('owner');
 for(const f of ['totalInvoiced','totalOutstanding','totalPaidThisMonth'])
  assert.ok(Array.isArray(sum[f]),'PurchaseSummary.'+f+' was flattened back to a scalar');

 // Totals are identical at one page and at twenty.
 for(let i=0;i<60;i++) await mkBill(100+i, i%2 ? 'PKR' : 'USD');
 const whole=(await bills.getFilteredBills('owner',{status:'all'},1000)).billSummary;
 let page=null, pages=0;
 do { const r=await bills.getFilteredBills('owner',{status:'all'},5,0,page); page=r.nextCursor; pages++;
      assert.deepEqual(plain(r.billSummary),plain(whole),'the summary changed between pages'); } while(page && pages<40);
 assert.ok(pages>=5,'the fixture must actually page');

 // The SQL does the grouping, not JavaScript.
 for(const [file,needles] of [
  ['src/services/database/billDb.ts',['GROUP BY currency','GROUP BY date(bill_date), currency']],
  ['src/services/database/expenseDb.ts',['GROUP BY currency','GROUP BY date(expense_date), currency']],
  ['src/services/database/purchaseDb.ts',['GROUP BY currency','GROUP BY date(po.order_date), po.currency','GROUP BY date(pi.invoice_date), pi.currency']],
 ]) for(const n of needles) assert.ok(read(file).includes(n),file+' is missing: '+n);

 // An export must reconcile with the screen, and say which currency.
 const pdfSrc=read('src/components/Download/pdfGenerator.ts');
 assert.ok(/stackedTotalText\(expenseSummary\.totalExpense/.test(pdfSrc),'the expense PDF collapses a mixed total');
 assert.ok(/stackedTotalText\(billSummary\.totalBilled/.test(pdfSrc),'the bill PDF collapses a mixed total');
 assert.ok(pdfSrc.includes("'Currency', 'Amount'"),'the expense CSV has no currency column');

 // The suppressed figure is grouped and safe to show now.
 assert.ok(Array.isArray(await bills.calculatePendingPayments('owner')),'pendingPayments is still a flat cross-currency SUM');
 assert.ok(!/never render it/.test(read('src/store/useDashboardStore.ts')),'the "never render it" warning is stale');
}));

check(130,'bill SMS: plain text, no recipient, no attachment; the body carries the bill\u2019s OWN currency; English fits one segment even at the worst realistic size, and the part count is shown before the messaging app opens',at('src/screens/BillBook/BillDetailScreen.tsx','handleSendSms'),()=>isolated(async h=>{
 const sms=h.load('src/utils/sms.ts');
 const calcApi=calc(h);
 const en=h.load('src/i18n/en.ts').en, ur=h.load('src/i18n/ur.ts').ur;
 const tr=h.load('src/i18n/translate.ts').translate;
 const body=(lang,shop,no,total,paid,due)=>tr(lang,'billSmsBody',{shop,no,total,paid,due});

 // ── The cost model itself ──────────────────────────────────────────────────
 assert.deepEqual(plain(sms.smsCost('hello')),{encoding:'GSM-7',units:5,parts:1,perPart:160});
 // A GSM escape character is billed TWICE — the reason the body uses no pipes.
 assert.equal(sms.smsCost('|').units,2);
 // ONE non-GSM character drops capacity from 160 to 70. This is why no currency
 // prefix in this app is a symbol and why no SMS body may carry an emoji.
 assert.equal(sms.smsCost('a'.repeat(100)).parts,1);
 assert.equal(sms.smsCost('a'.repeat(100)+'\u06A9').encoding,'UCS-2');
 assert.equal(sms.smsCost('a'.repeat(100)+'\u06A9').parts,2);
 assert.equal(sms.smsCost('a'.repeat(160)).parts,1);
 assert.equal(sms.smsCost('a'.repeat(161)).parts,2,'161 GSM characters is two parts');
 assert.equal(sms.smsCost('\u06A9'.repeat(70)).parts,1);
 assert.equal(sms.smsCost('\u06A9'.repeat(71)).parts,2,'71 Urdu characters is two parts');

 // ── English fits ONE segment, including the worst realistic bill ───────────
 const small=body('en','AL-REEF','1042',calcApi.formatCurrency(1250000),calcApi.formatCurrency(500000),calcApi.formatCurrency(750000));
 assert.equal(sms.smsCost(small).encoding,'GSM-7','an English bill must not fall into the expensive encoding');
 assert.equal(sms.smsCost(small).parts,1);
 const worst=body('en','Al Reef General Trading LLC','104298',
   calcApi.formatCurrency(125400075,'AED'),calcApi.formatCurrency(100000000,'AED'),calcApi.formatCurrency(25400075,'AED'));
 assert.equal(sms.smsCost(worst).parts,1,'the worst realistic English bill must still be one message: '+sms.smsCost(worst).units+' units');

 // ── The body carries every required field, in the BILL'S currency ──────────
 for(const [code,shown] of [['PKR','Rs. 1,000'],['AED','AED 1,000'],['USD','USD 1,000'],['CNY','CNY 1,000']]){
  const b=body('en','AL-REEF','7',calcApi.formatCurrency(100000,code),calcApi.formatCurrency(0,code),calcApi.formatCurrency(100000,code));
  assert.ok(b.includes(shown),code+' is not rendered in its own currency: '+b);
  assert.ok(b.includes('AL-REEF')&&b.includes('7'),'shop name and bill number must be present');
 }
 // Formatted ONCE: no doubled prefix anywhere.
 assert.ok(!/Rs\. *Rs\.|AED +AED|USD +USD|CNY +CNY/.test(body('en','S','1',calcApi.formatCurrency(100,'AED'),calcApi.formatCurrency(0,'AED'),calcApi.formatCurrency(100,'AED'))));

 // ── No emoji anywhere in either dictionary's SMS strings ───────────────────
 const emoji=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
 for(const dict of [en,ur]) for(const k of Object.keys(dict))
  if(/^billSms/.test(k)) assert.ok(!emoji.test(dict[k]),k+' contains an emoji, which forces the expensive encoding');

 // ── Urdu: honest about cost. The SHORT labels must keep a normal bill to one ─
 const urShort=body('ur','AL-REEF','1042',calcApi.formatCurrency(1250000),calcApi.formatCurrency(500000),calcApi.formatCurrency(750000));
 assert.equal(sms.smsCost(urShort).encoding,'UCS-2');
 assert.equal(sms.smsCost(urShort).parts,1,'a normal Urdu bill must fit one segment: '+sms.smsCost(urShort).units+' units');
 // And the screen must TELL the user when it will not.
 const src=read('src/screens/BillBook/BillDetailScreen.tsx');
 assert.ok(/smsCost\(body\)/.test(src),'the part count is never computed');
 assert.ok(/billSmsConfirmMany/.test(src)&&/parts: String\(parts\)/.test(src),'the user is not told the part count');
 assert.ok(/billSmsConfirmOne/.test(src));

 // ── Plain text, no recipient, nothing attached, never silent ───────────────
 assert.ok(/sms:\$\{sep\}body=/.test(src),'the sms URL must carry a body and NO recipient');
 const smsFn=src.slice(src.indexOf('const handleSendSms'),src.indexOf('const handleShareWhatsApp'));
 assert.ok(!/sms:[^`]*${(to|phone|recipient|party)/i.test(smsFn),'a recipient was put into the sms URL');
 assert.ok(!/Sharing\.shareAsync|printToFileAsync|attachment|\.pdf/i.test(smsFn),'the SMS path must never offer a file');
 assert.ok(/Alert\.alert\(/.test(smsFn)&&smsFn.indexOf('Alert.alert')<smsFn.indexOf('Linking.openURL'),'the messaging app opens without confirming first');
 assert.ok(/formatCurrency\(bill\.total, bill\.currency\)/.test(smsFn)&&/formatCurrency\(bill\.due, bill\.currency\)/.test(smsFn),'the SMS ignores the bill currency');
 // It sits with the other two share actions, and that row must wrap rather than
 // squeeze three labels — Urdu runs ~40% longer than English.
 assert.ok(/billSendSms/.test(src)&&/commonShareWhatsApp/.test(src)&&/billDownload/.test(src),'the three actions are not together');
 assert.ok(/flexWrap: 'wrap'/.test(src),'three buttons in a fixed row will clip the Urdu labels');
}));

check(131,'the app runs on BOTH platforms: every launcher asset is a real square PNG, every platform branch handles iOS as well as Android, and a scheme the app asks canOpenURL about is declared for iOS or the button lies on an iPhone',at('app.config.js','LSApplicationQueriesSchemes'),()=>{
 const fsx=require('fs'), pathx=require('path');
 // ── Launcher assets. Android masks the adaptive icon to a circle and iOS rejects a
 //    non-square icon outright, so both must be square PNGs, not JPEGs wearing .png.
 const png=b=>b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47;
 for(const [name,square] of [['icon.png',true],['adaptive-icon.png',true],['favicon.png',true],['splash.png',false]]){
  const b=fsx.readFileSync(pathx.join(root,'assets',name));
  assert.ok(png(b),'assets/'+name+' is not a real PNG (AAPT and iOS both reject a mislabelled file)');
  const w=b.readUInt32BE(16), h=b.readUInt32BE(20);
  if(square) assert.equal(w,h,'assets/'+name+' must be square: '+w+'x'+h);
 }
 const icon=fsx.readFileSync(pathx.join(root,'assets','icon.png'));
 assert.ok(icon.readUInt32BE(16)>=1024,'the app icon must be at least 1024px');

 // ── iOS: canOpenURL answers FALSE for any undeclared scheme, installed or not.
 const cfg=read('app.config.js');
 const asked=new Set();
 for(const f of sourceFiles()){
  const src=fsx.readFileSync(f,'utf8');
  for(const m of src.matchAll(/canOpenURL\(\s*`?([a-z][a-z0-9.+-]*):/gi)) asked.add(m[1].toLowerCase());
  // A template variable holding the url: catch the common `const url = \`scheme://` shape.
  for(const m of src.matchAll(/const\s+url\s*=\s*`([a-z][a-z0-9.+-]*):\/\//gi))
   if(/canOpenURL\(url\)/.test(src)) asked.add(m[1].toLowerCase());
 }
 for(const scheme of asked){
  if(scheme==='sms'||scheme==='tel'||scheme==='mailto'||scheme==='http'||scheme==='https') continue;
  assert.ok(cfg.includes('LSApplicationQueriesSchemes') && cfg.includes('"' + scheme + '"'),
   'canOpenURL asks about "'+scheme+'" but iOS is not told to allow it — on an iPhone that check always fails');
 }
 assert.ok(asked.size>0,'the scanner found no canOpenURL scheme at all — the pattern has rotted');

 // ── Every platform branch must handle iOS, not just fall through to Android. ──
 const bad=[];
 for(const f of sourceFiles()){
  const src=fsx.readFileSync(f,'utf8');
  const rel=f.slice(root.length+1);
  // A keyboard listener must use the WILL events on iOS; the DID events fire too late
  // and the layout jumps under the keyboard.
  if(/keyboardDidShow/.test(src)&&!/keyboardWillShow/.test(src)) bad.push(rel+': keyboard listener has no iOS branch');
  // KeyboardAvoidingView needs behavior="padding" on iOS or the keyboard covers inputs.
  if(/<KeyboardAvoidingView/.test(src)&&!/Platform\.OS === 'ios'/.test(src)) bad.push(rel+': KeyboardAvoidingView has no iOS behavior');
 }
 assert.deepEqual(bad,[],'iOS would behave differently here:\n  '+bad.join('\n  '));

 // ── The SMS separator differs by platform: iOS '&', Android '?'. ──────────────
 const billScreen=read('src/screens/BillBook/BillDetailScreen.tsx');
 assert.ok(/Platform\.OS === 'ios' \? '&' : '\?'/.test(billScreen),'the sms URL separator is wrong on one platform');
});

check(132,'khata entries are linked to customers by id (v42), not by matching a name: a renamed customer keeps their history, two customers sharing a name keep separate ledgers, an unmatched entry still shows via partyName, and the list is a paged SQL aggregate',at('src/services/database/transactionDb.ts','getPartyBalances'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const kh=khata(h);
 const cust=customerDb(h);
 const list=(opts={})=>kh.getPartyBalances('owner',opts);
 const find=(rows,name)=>rows.find(r=>r.partyName===name);

 // ── A customer with NO transactions is still a customer ──────────────────────
 const fresh=await cust.addCustomer({user_id:'owner',name:'Zero Balance'});
 const all0=(await list({})).rows;
 const z=find(all0,'Zero Balance');
 assert.ok(z,'a newly added customer must appear in the khata list');
 assert.equal(z.netBalance,0);
 assert.equal(z.customerId,fresh.id,'it must be linked by id, not matched by name');

 // ── A renamed customer keeps their history ───────────────────────────────────
 const ali=await cust.addCustomer({user_id:'owner',name:'Ali Traders'});
 await kh.createTransaction('owner','Ali Traders',50000,'lena','','2026-09-10');
 await kh.createTransaction('owner','Ali Traders',20000,'dena','','2026-09-11');
 assert.equal(find((await list({})).rows,'Ali Traders').netBalance,30000);
 await cust.updateCustomer(ali.id,'owner',{name:'Ali Brothers'});
 const renamed=(await list({})).rows;
 const after=find(renamed,'Ali Brothers');
 assert.ok(after,'the renamed customer vanished');
 assert.equal(after.netBalance,30000,'renaming a customer lost their history — the whole point of v42');
 assert.equal(find(renamed,'Ali Traders'),undefined,'the old name must not linger as a second party');

 // ── Two customers sharing a name keep SEPARATE ledgers ───────────────────────
 const bilalA=await cust.addCustomer({user_id:'owner',name:'Bilal',phone:'03001112222'});
 const bilalB=await cust.addCustomer({user_id:'owner',name:'Bilal',phone:'03003334444'});
 await kh.createTransaction('owner','Bilal',10000,'lena','','2026-09-12');
 // The entry above is name-keyed and AMBIGUOUS, so it must not attach to either Bilal.
 const bilals=(await list({})).rows.filter(r=>r.partyName==='Bilal');
 assert.equal(bilals.length,3,'two customers plus the unattached entry should be three rows, got '+bilals.length);
 assert.equal(bilals.filter(r=>r.customerId===bilalA.id).length,1);
 assert.equal(bilals.filter(r=>r.customerId===bilalB.id).length,1);
 const orphan=bilals.find(r=>r.customerId===null);
 assert.ok(orphan,'the ambiguous entry must still be visible under its party name');
 assert.equal(orphan.netBalance,10000,'an entry that could not be linked must never vanish');
 for(const b of bilals.filter(r=>r.customerId)) assert.equal(b.netBalance,0,'an ambiguous entry was guessed onto a customer');

 // ── An entry whose customer never existed still shows ────────────────────────
 await kh.createTransaction('owner','Typo Nmae',7000,'lena','','2026-09-13');
 const typo=find((await list({})).rows,'Typo Nmae');
 assert.ok(typo&&typo.customerId===null&&typo.netBalance===7000,'an unmatched entry must display via partyName');

 // ── Totals are SQL, and identical at one page and at twenty ──────────────────
 for(let i=0;i<60;i++) await cust.addCustomer({user_id:'owner',name:'Cust '+String(i).padStart(3,'0')});
 const whole=(await list({limit:1000})).rows;
 const paged=[];let cur=null,guard=0;
 do{ const pg=await list({limit:3,after:cur}); paged.push(...pg.rows); cur=pg.nextCursor; guard++; }while(cur&&guard<200);
 assert.ok(guard>=5,'the fixture must actually page, got '+guard+' pages');
 assert.deepEqual(plain(paged.map(r=>r.partyName+'|'+(r.customerId||''))),
                  plain(whole.map(r=>r.partyName+'|'+(r.customerId||''))),'paging skipped or repeated a row');
 assert.deepEqual(plain(paged.map(r=>r.netBalance)),plain(whole.map(r=>r.netBalance)),'a balance changed between pages');

 // ── Search runs in SQL: name, phone and the balance as typed ─────────────────
 assert.deepEqual((await list({search:'Ali Bro'})).rows.map(r=>r.partyName),['Ali Brothers']);
 assert.equal((await list({search:'03003334444'})).rows.length,1,'phone search');
 for(const typed of ['30000','300.00','Rs. 300','300']){
  const hit=(await list({search:typed})).rows;
  if(typed==='30000') assert.equal(hit.length,0,'30000 is paisa, not what a user types');
  else assert.ok(hit.some(r=>r.partyName==='Ali Brothers'),'amount search failed for "'+typed+'"');
 }
 // A literal % must not behave as a wildcard.
 await cust.addCustomer({user_id:'owner',name:'50% Off Store'});
 assert.deepEqual((await list({search:'50%'})).rows.map(r=>r.partyName),['50% Off Store']);

 // ── Own-only scoping still holds ─────────────────────────────────────────────
 await cust.addCustomer({user_id:'staffA',name:'Not Mine'});
 assert.equal(find((await list({})).rows,'Not Mine'),undefined,'another account\u2019s customer leaked into this list');

 // ── The aggregate is SQL, and the screen no longer filters a loaded array ────
 const src=read('src/services/database/transactionDb.ts');
 const fn=src;  // the query is assembled from consts above the function now
 assert.ok(/GROUP BY k/.test(fn),'balances must be aggregated in SQL, once per party');
 assert.ok(/LEFT JOIN agg a ON a.k = p.k/.test(fn),'the join must be a single-key equality, not an OR — an OR join scans every transaction per party and hangs');
 assert.ok(/LIMIT \?/.test(fn),'the customer list must be paged in SQL');
 assert.ok(!/\.filter\(/.test(fn),'the aggregate is being finished in JavaScript');
 const screen=read('src/components/khata/CustomerBalanceList.tsx');
 assert.ok(!/\.filter\(/.test(screen),'the screen filters a loaded array again');
}));

check(133,'Khata opens on the CUSTOMER LIST: every customer shows without any interaction, one with no transactions shows at zero, the header totals are SQL over the whole searched set and identical at one page and twenty, and no Add-customer button remains',at('src/screens/staff/KhataScreen.tsx','khataTabCustomers'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const kh=khata(h), cust=customerDb(h);

 // ── The list renders with NO search and NO interaction ──────────────────────
 await cust.addCustomer({user_id:'owner',name:'Never Traded'});
 const quiet=await kh.getPartyBalances('owner',{});
 assert.ok(quiet.rows.some(r=>r.partyName==='Never Traded'),'a customer must appear without searching for them');
 assert.equal(quiet.rows.find(r=>r.partyName==='Never Traded').netBalance,0,'a customer with no transactions belongs at zero');

 // ── Header totals are SQL over the WHOLE set, and agree with the list ───────
 const names=[];
 for(let i=0;i<40;i++){
  const n='P'+String(i).padStart(3,'0');names.push(n);
  await cust.addCustomer({user_id:'owner',name:n});
  await kh.createTransaction('owner',n,1000+i,'lena','','2026-09-10');
  if(i%2) await kh.createTransaction('owner',n,500,'dena','','2026-09-11');
 }
 const grand=await kh.getKhataGrandTotals('owner',{});
 const everyRow=(await kh.getPartyBalances('owner',{limit:1000})).rows;
 assert.equal(grand.totalLena,everyRow.reduce((a,r)=>a+r.totalLena,0),'the header must equal the whole list');
 assert.equal(grand.totalDena,everyRow.reduce((a,r)=>a+r.totalDena,0));
 assert.equal(grand.netBalance,grand.totalLena-grand.totalDena);

 // Identical at one page and at twenty — the header must NOT follow the page.
 let cur=null,seen=0,pages=0;
 do{ const pg=await kh.getPartyBalances('owner',{limit:2,after:cur}); seen+=pg.rows.length; cur=pg.nextCursor; pages++;
     const g=await kh.getKhataGrandTotals('owner',{});
     assert.equal(g.totalLena,grand.totalLena,'the header changed while paging');
     assert.equal(g.totalDena,grand.totalDena);
 }while(cur&&pages<200);
 assert.ok(pages>=20,'the fixture must actually page, got '+pages);
 assert.equal(seen,everyRow.length,'paging lost or repeated a row');

 // The header follows the SEARCH too, so it always describes the list beneath it.
 const narrowed=await kh.getKhataGrandTotals('owner',{search:'P00'});
 const narrowRows=(await kh.getPartyBalances('owner',{search:'P00',limit:1000})).rows;
 assert.ok(narrowRows.length>0&&narrowRows.length<everyRow.length,'the search must actually narrow');
 assert.equal(narrowed.totalLena,narrowRows.reduce((a,r)=>a+r.totalLena,0),'the header ignores the search');

 // ── The screen: customer list by default, activity behind the toggle ────────
 const ks=read('src/screens/staff/KhataScreen.tsx');
 assert.ok(/<CustomerBalanceList/.test(ks),'Khata must render the customer list itself');
 assert.ok(/useState<'customers' \| 'activity'>\('customers'\)/.test(ks),'Khata must OPEN on the customer list');
 assert.ok(/getKhataGrandTotals\(/.test(ks),'the header must use the SQL grand totals, not the range summary');
 assert.ok(!/navigation\.navigate\('CustomerLedger'/.test(ks),'the hidden link should be gone');

 // No Add-customer anywhere in the khata views: Customer Book is the one place.
 for(const f of ['src/screens/staff/KhataScreen.tsx','src/components/khata/CustomerBalanceList.tsx'])
  assert.ok(!/AddCustomerModal/.test(read(f)),f+' still offers to add a customer');
 // ...and the other creation paths are untouched, so a customer can still be made.
 assert.ok(/AddCustomerModal/.test(read('src/screens/CustomerBook/CustomerBookScreen.tsx'))
         ||/addCustomer\(/.test(read('src/screens/CustomerBook/CustomerBookScreen.tsx')),'Customer Book must still create customers');
 assert.ok(/AddCustomerModal/.test(read('src/screens/staff/AddTransactionScreen.tsx')),'the add-entry screen must still create a customer');

 // ── Dense, tokens only, and colour never the only signal ────────────────────
 const list=read('src/components/khata/CustomerBalanceList.tsx');
 assert.equal((list.match(/#[0-9A-Fa-f]{3,8}\b/g)||[]).length,0,'hardcoded colour in the customer list');
 assert.ok(/minHeight: touchTarget/.test(list),'rows must stay tappable');
 assert.ok(/khataSettled/.test(list),'a zero balance needs a word, not just neutral ink');
 assert.ok(/tone = owed > 0 \? 'out' : owed < 0 \? 'in' : 'neutral'/.test(list),'debit red, credit green, zero neutral');
 assert.ok(/khataNoCustomers/.test(list)&&/khataAddInCustomerBook/.test(list),'an empty list must say so and point at Customer Book');
}));
check(136,'the REPORTS tab obeys multi-currency too: no reports/ aggregate over a currency-bearing table is a flat SUM, a mixed period never produces one blended figure, profit and every ranking refuse to compare across currencies, and a single-currency account sees exactly what it always saw',at('src/services/database/reports/salesReportDb.ts','GROUP BY currency'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const bills=h.load('src/services/database/billDb.ts');
 const exp=h.load('src/services/database/expenseDb.ts');
 const sales=h.load('src/services/database/reports/salesReportDb.ts');
 const pnl=h.load('src/services/database/reports/profitLossDb.ts');
 const party=h.load('src/services/database/reports/partyReportDb.ts');
 const expRep=h.load('src/services/database/reports/expenseReportDb.ts');
 const inv=h.load('src/services/database/reports/inventoryReportDb.ts');

 const day='2026-09-10';
 const range={startDate:'2026-09-01',endDate:'2026-09-30'};
 const mkBill=(total,currency,party_name)=>bills.createBill(
  {user_id:'owner',customer_id:'walk_in',party_name,bill_date:day,subtotal:total,discount_pct:0,discount_amount:0,
   tax_amount:0,total,paid:0,payment_method:'cash',is_draft:0,is_hold:0,currency},
  [{item_name:'X',quantity:1,unit_price:total,line_total:total}]);

 // ── A single-currency account is UNCHANGED: one line, and it is the real figure ────
 await mkBill(4500000,'PKR','Al Noor');
 const onlyPkr=await sales.getSalesReportSummary('owner',range);
 assert.equal(only(onlyPkr.totalSales,'totalSales'),4500000,'a single-currency total must be exactly what it always was');
 assert.equal(only(onlyPkr.averageBillValue,'averageBillValue'),4500000);
 assert.equal(onlyPkr.totalBills,1,'counting bills is currency-free');
 const pnlPkr=await pnl.getProfitLossSummary('owner',range);
 assert.equal(pnlPkr.profitAvailable,true,'one currency, and it is the account default — profit is computable');
 assert.equal(pnlPkr.profitCurrency,'PKR');

 // ── Add ONE foreign bill and nothing may blend ────────────────────────────────────
 await mkBill(300000,'AED','Dubai Metals');
 const mixed=await sales.getSalesReportSummary('owner',range);
 assert.equal(mixed.totalSales.length,2,'a mixed period must report one figure per currency');
 assert.deepEqual(plain(mixed.totalSales),[{currency:'PKR',amount:4500000},{currency:'AED',amount:300000}],
  'the account default must lead, and neither figure may move');
 const blended=4500000+300000;
 for(const line of mixed.totalSales)
  assert.notEqual(line.amount,blended,'PKR and AED were added together: '+JSON.stringify(mixed.totalSales));
 assert.equal(mixed.totalBills,2,'the count still covers every currency');
 // The average is each currency divided by ITS OWN count, never the blend over the blend.
 assert.deepEqual(plain(mixed.averageBillValue),[{currency:'PKR',amount:4500000},{currency:'AED',amount:300000}]);
 for(const line of mixed.averageBillValue)
  assert.notEqual(line.amount,Math.round(blended/2),'the average was taken across currencies');

 const trend=await sales.getSalesTrend('owner',range,'day');
 const theDay=trend.find(d=>d.date===day);
 assert.equal(theDay.total.length,2,'a mixed DAY must stack too');
 assert.equal(theDay.count,2);

 // ── Profit REFUSES rather than inventing a number ─────────────────────────────────
 const pnlMixed=await pnl.getProfitLossSummary('owner',range);
 assert.equal(pnlMixed.profitAvailable,false,'profit cannot span currencies — there is no rate');
 assert.equal(pnlMixed.netProfit,null,'a refused profit must be null, not a blended number');
 assert.equal(pnlMixed.grossProfit,null);
 assert.equal(pnlMixed.profitMarginPct,null);
 assert.equal(pnlMixed.profitCurrency,null);
 assert.equal(pnlMixed.totalRevenue.length,2,'the components are still shown, per currency');
 for(const line of pnlMixed.totalRevenue) assert.notEqual(line.amount,blended);
 const pnlTrend=await pnl.getProfitTrend('owner',range);
 assert.equal(pnlTrend.find(d=>d.date===day).profit,null,'a mixed day has no single profit');

 // ── RANKING: separate ordered lists, never one order across currencies ────────────
 const top=await party.getCustomerPerformance('owner',range,'totalPurchases',10);
 assert.ok(Array.isArray(top)&&top.length===2,'top buyers must be grouped per currency, got '+JSON.stringify(top));
 assert.deepEqual(plain(top.map(g=>g.currency)),['PKR','AED'],'groups follow the account-default-first order');
 for(const g of top){
  assert.equal(g.rows.length,1);
  // Every row inside a group is denominated in that group's currency, so comparing
  // them is legitimate; nothing here may be compared with a row from another group.
  for(let i=1;i<g.rows.length;i++)
   assert.ok(g.rows[i-1].totalPurchases>=g.rows[i].totalPurchases,'rows must descend WITHIN a currency');
 }
 assert.equal(top.find(g=>g.currency==='AED').rows[0].customerName,'Dubai Metals');
 assert.equal(top.find(g=>g.currency==='PKR').rows[0].totalPurchases,4500000);
 assert.ok(top.every(g=>g.rows.every(r=>typeof r.totalPurchases==='number')),'a row figure must stay scalar inside its group');

 // Per-currency top-N, not a global N that one currency can crowd out.
 for(let i=0;i<12;i++) await mkBill(1000+i,'AED','D'+i);
 const capped=await party.getCustomerPerformance('owner',range,'totalPurchases',10);
 assert.equal(capped.find(g=>g.currency==='AED').rows.length,10,'the limit must apply per currency');
 assert.equal(capped.find(g=>g.currency==='PKR').rows.length,1,'the PKR list must not be crowded out by AED rows');

 // ── Expenses: the breakdown, the ranking AND the percentages stay per currency ────
 await exp.addExpenseRecord({user_id:'owner',amount:1250000,description:'Power',expense_date:day,category:'Electricity',currency:'PKR'});
 await exp.addExpenseRecord({user_id:'owner',amount:200000,description:'Rent',expense_date:day,category:'Rent',currency:'AED'});
 const es=await expRep.getExpenseSummary('owner',range);
 assert.equal(es.totalExpenses.length,2,'the expense total must stack');
 for(const line of es.totalExpenses) assert.notEqual(line.amount,1250000+200000,'expense currencies were summed');
 assert.deepEqual(plain(es.byCurrency.map(g=>g.currency)),['PKR','AED'],'expense categories must be grouped per currency');
 for(const g of es.byCurrency){
  const share=g.categories.reduce((n,c)=>n+c.percentage,0);
  assert.ok(Math.abs(share-100)<0.01,'a share must be of its OWN currency total, got '+share+'% for '+g.currency);
 }
 const et=await expRep.getExpenseTrend('owner',range);
 assert.ok(et.every(m=>Array.isArray(m.total)),'the expense trend was flattened back to a scalar');

 // ── Best sellers: ranked per currency, and profit is blank outside the account's ──
 // Best sellers join bill lines to stock items, so the lines need a real item_id; the
 // bills above deliberately have none, which is why these rows are inserted directly.
 h.insert('stock_items',{id:'s1',user_id:'owner',name_en:'Rice',purchase_price:400,sale_price:1000,quantity:100});
 const linked=(id,total,currency)=>{
  h.insert('bills',{id,user_id:'owner',bill_no:900+Number(id.slice(1)),customer_id:'walk_in',party_name:'L'+id,
   bill_date:day,subtotal:total,total,paid:0,due:total,status:'unpaid',is_draft:0,is_hold:0,currency});
  h.insert('bill_items',{id:'li'+id,bill_id:id,item_id:'s1',item_name:'Rice',quantity:1,unit_price:total,line_total:total,returned_quantity:0});
 };
 linked('L1',900,'PKR'); linked('L2',700,'AED');
 const best=await inv.getProductPerformance('owner',range.startDate,range.endDate,'revenue','DESC',10);
 assert.deepEqual(plain(best.map(g=>g.currency)),['PKR','AED'],'best sellers must be grouped per currency');
 assert.equal(typeof best.find(g=>g.currency==='PKR').rows[0].profit,'number','profit is real in the account currency');
 assert.equal(best.find(g=>g.currency==='AED').rows[0].profit,null,
  'profit subtracts a cost that has NO currency, so it cannot be stated against an AED sale');

 // ── Nothing in reports/ may go back to a flat SUM over a currency-bearing table ───
 // A static guard, because the next aggregate someone adds will not be in the fixture
 // above. Only bills / bill_items / expenses carry a currency; cashbook, transactions
 // and stock_items deliberately do not, so they are exempt BY NAME, not by omission.
 const dir='src/services/database/reports';
 const CURRENCY_TABLES=/\b(FROM|JOIN)\s+(bills|bill_items|expenses)\b/i;
 for(const f of fs.readdirSync(path.join(root,dir))){
  if(!f.endsWith('.ts')||f==='types.ts'||f==='index.ts') continue;
  const src=read(dir+'/'+f);
  // Each backtick-delimited SQL literal in the file, examined on its own.
  for(const sql of (src.match(/\u0060[^\u0060]*\u0060/g)||[])){
   if(!/\bSELECT\b/i.test(sql)||!/\bSUM\s*\(/i.test(sql)) continue;
   if(!CURRENCY_TABLES.test(sql)) continue;           // cash / khata / stock: no currency column
   assert.ok(/GROUP BY[^\u0060]*currency/i.test(sql),
    dir+'/'+f+' has a SUM over a currency-bearing table with no GROUP BY ... currency:\n'+sql.slice(0,400));
  }
 }
 // reportDb.ts was DELETED on 2026-10-06: a third copy of staff sales that nothing
 // imported, held to this rule only so that it could not reintroduce a cross-currency
 // SUM if it were ever wired up. The live figures come from reports/staffReportDb,
 // which the loop above covers. Two parallel copies are how the first two drifted, so
 // assert the file stays gone rather than policing its SQL.
 assert.ok(!fs.existsSync(path.join(root,'src/services/database/reportDb.ts')),
  'reportDb.ts is back: a third parallel implementation of staff sales, free to drift from the figures the app shows');

 // ── The exports reconcile with the screens ───────────────────────────────────────
 const pdfSrc=read('src/components/Download/pdfGenerator.ts');
 assert.ok(/formatCurrency\(r\.total \?\? 0, r\.currency\)/.test(pdfSrc),
  'the bill PDF prints a row in PKR whatever currency the bill is in');
 assert.ok(/formatCurrency\(r\.paid \?\? 0, r\.currency\)/.test(pdfSrc));
 assert.ok(/formatCurrency\(r\.due \?\? 0, r\.currency\)/.test(pdfSrc));
 assert.ok(pdfSrc.includes("'Customer', 'Currency', 'Total', 'Paid', 'Due'"),
  'the bill CSV has no Currency column, so AED and PKR are two bare numbers in one column');

 // ── One helper, not three copies that can drift ──────────────────────────────────
 assert.equal((read('src/services/database/billDb.ts').match(/const accountCurrencyOf = async/g)||[]).length,0,
  'billDb kept a private copy of accountCurrencyOf');
 assert.equal((read('src/services/database/expenseDb.ts').match(/const accountCurrencyOf = async/g)||[]).length,0,
  'expenseDb kept a private copy of accountCurrencyOf');
}));

check(134,'every screen that LISTS data refreshes when it regains focus: a list that only loads on mount shows balances from before the last write, and two screens then disagree about the same customer',at('src/components/khata/CustomerBalanceList.tsx','useFocusEffect'),()=>{
 const fsx=require('fs');
 // Loaders that read a LIST or an AGGREGATE. If a screen shows one of these and the
 // user can navigate away, write something, and come back, it must re-query —
 // otherwise it keeps pre-write figures. This is exactly how the Khata customer list
 // came to show Rs. 500 owing for a customer whose own ledger said Rs. 0 settled.
 const LOADERS=['getFilteredKhata','getPartyBalances','getKhataGrandTotals','getFilteredBills',
  'getFilteredExpenses','getFilteredCashHistory','getFilteredPurchaseOrders','getFilteredPurchaseInvoices',
  'searchCustomers','getStaffRecords','getStockItemsByUserId','refreshDashboard','getPurchaseSummary'];
 // Entry FORMS are exempt: they mount fresh every time they are opened and are never
 // returned to, so there is no stale window. Each is listed deliberately, not by a
 // pattern, so a new screen cannot quietly inherit the exemption.
 const FORMS=[
  'src/screens/BillBook/CreateNewBillModal.tsx',
  'src/screens/CashBook/CashEntryModal.tsx',
  'src/screens/ExpenseBook/AddExpenseModal.tsx',
  'src/screens/PurchaseBook/CreatePurchaseInvoiceModal.tsx',
  'src/screens/PurchaseBook/CreatePurchaseOrderModal.tsx',
  'src/screens/staff/AddTransactionScreen.tsx',
 ];
 // Detail screens that reload after their OWN writes and offer no navigate-away path.
 const SELF_REFRESHING=[
  'src/screens/staff/CustomerDetailScreen.tsx',
  'src/screens/StaffBook/StaffDetail.tsx',
 ];
 const offenders=[];
 for(const file of sourceFiles()){
  if(!file.endsWith('.tsx'))continue;
  const text=fsx.readFileSync(file,'utf8');
  const rel=file.slice(root.length+1).split(require('path').sep).join('/');
  if(FORMS.includes(rel)||SELF_REFRESHING.includes(rel))continue;
  if(!LOADERS.some(l=>text.includes(l+'(')))continue;
  const refreshes=text.includes('useFocusEffect')||text.includes("addListener('focus'")
    ||text.includes('addListener("focus"')||text.includes('useIsFocused');
  if(!refreshes)offenders.push(rel);
 }
 assert.deepEqual(offenders,[],'these list data but never refresh on focus, so they show pre-write figures:\n  '+offenders.join('\n  '));
 // And the component the bug was actually in must keep its refresh.
 const list=read('src/components/khata/CustomerBalanceList.tsx');
 assert.ok(/useFocusEffect\(useCallback\(\(\) => \{ load\(\); \}, \[load\]\)\)/.test(list),
  'the khata customer list must reload on focus — it is reached straight back from the ledger that writes to it');
 // The exemption lists must not rot into cover for a real screen.
 for(const f of [...FORMS,...SELF_REFRESHING]) assert.ok(fsx.existsSync(require('path').join(root,f)),'exempted file no longer exists: '+f);
});

check(135,'the app never claims data is backed up when sync does not exist: with Firebase unconfigured, pendingCount is 0 because nothing is ever queued, which previously read as "All changes synced" — a false assurance about data safety',at('src/screens/staff/SettingsScreen.tsx','setSyncLocalOnly'),()=>{
 const settings=read('src/screens/staff/SettingsScreen.tsx');
 const centre=read('src/screens/sync/SyncCenterScreen.tsx');

 // Both surfaces must branch on whether sync EXISTS before saying anything about it.
 for(const [name,src] of [['Settings',settings],['Sync centre',centre]]){
  assert.ok(/IS_FIREBASE_CONFIGURED/.test(src),name+' reports sync status without checking whether sync is configured');
 }
 assert.ok(/setSyncLocalOnly/.test(settings)&&/setSyncLocalOnlySub/.test(settings),
  'Settings must say plainly that nothing is backed up when sync is not set up');
 assert.ok(/syncNotSetUp/.test(centre),'the Sync centre must not report "Online" as though sync worked');

 // The reassuring strings must be UNREACHABLE unless sync is configured: no bare
 // "All changes synced" that can render with Firebase off.
 assert.ok(!/'All changes synced'/.test(settings)&&!/"All changes synced"/.test(settings),
  'a hardcoded "All changes synced" can still render with sync switched off');
 assert.ok(!/'Up to date'/.test(settings),'a hardcoded "Up to date" can still render with sync switched off');
 assert.ok(!/'Online'/.test(centre),'a hardcoded "Online" can still render with sync switched off');

 // These were hardcoded English on a screen the Urdu pass reported as complete, so an
 // Urdu user saw English. Every sync string must come from the dictionaries.
 const en=require(root+'/node_modules/typescript')?null:null;
 const dicts=(()=>{const h=harness();try{return {en:h.load('src/i18n/en.ts').en,ur:h.load('src/i18n/ur.ts').ur};}finally{h.dispose();}})();
 const enD=dicts.en, urD=dicts.ur;
 for(const k of ['setSyncLocalOnly','setSyncLocalOnlySub','setSyncAllSynced','setSyncUpToDate',
                 'setSyncPending','setSyncWillSync','syncOnline','syncOffline','syncNotSetUp']){
  assert.ok(enD[k]&&enD[k].trim(),'missing en key '+k);
  assert.ok(urD[k]&&urD[k].trim(),'missing ur key '+k);
  assert.notEqual(urD[k],enD[k],k+' is not actually translated');
 }
 // The per-entry badge was already honest; keep it that way.
 assert.ok(/synced === 1 \|\| entry\.syncStatus === 'synced'/.test(read('src/screens/CashBook/CashEntryDetailScreen.tsx')),
  'the cash entry badge must only claim backup when the row really synced');
});

check(137,'a bill and a khata entry resolve a TYPED customer name through ONE shared rule, on CREATE and on EDIT: an exact single match links by id, an ambiguous or brand-new name stays unlinked rather than guessing, renaming re-links (and un-links) without becoming an editable or audited field, and the bill form asks before saving a name nobody is on record under',at('src/services/database/billDb.ts','matchCustomerByName'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const bills=h.load('src/services/database/billDb.ts');
 const cust=customerDb(h);
 const kh=khata(h);
 const WALK_IN=bills.WALK_IN_CUSTOMER_ID;
 assert.equal(WALK_IN,'walk_in','the walk-in sentinel changed; every stored bill and the form read the old value');

 const mk=(party_name,extra={})=>bills.createBill({user_id:'owner',customer_id:WALK_IN,party_name,
  bill_date:'2026-09-10',subtotal:10000,discount_pct:0,discount_amount:0,tax_amount:0,total:10000,
  paid:0,due:10000,status:'unpaid',payment_method:'cash',is_draft:0,is_hold:0,...extra},[]);
 const stored=id=>h.one('SELECT customer_id, party_name FROM bills WHERE id = ?',id);

 // ── A typed name that IS on record links by id, the same as a khata entry ────
 const sara=await cust.addCustomer({user_id:'owner',name:'Sara Cloth House'});
 const typed=await mk('Sara Cloth House');
 assert.equal(stored(typed.id).customer_id,sara.id,
  'a bill typed with an existing customer’s name was filed as a walk-in: it never reaches their ledger, and the Bill Book and the Khata then disagree about whether they exist');
 // The khata half of the same rule, through the same function.
 const txn=await kh.createTransaction('owner','Sara Cloth House',5000,'lena','',date);
 assert.equal(h.one('SELECT customer_id FROM transactions WHERE id = ?',txn.id).customer_id,sara.id,
  'the khata no longer links a typed name — the shared resolver regressed');

 // Surrounding whitespace is the same name, not a new party.
 assert.equal(stored((await mk('  Sara Cloth House ')).id).customer_id,sara.id,'the name is not trimmed before matching');

 // ── Two customers sharing a name: NEVER guess ───────────────────────────────
 await cust.addCustomer({user_id:'owner',name:'Bilal',phone:'03001112222'});
 await cust.addCustomer({user_id:'owner',name:'Bilal',phone:'03003334444'});
 assert.equal(stored((await mk('Bilal')).id).customer_id,WALK_IN,
  'an ambiguous name was guessed onto one of two customers, filing money on the wrong person’s ledger');

 // ── A brand-new name, and a deliberate walk-in, stay unlinked ───────────────
 assert.equal(stored((await mk('Nobody On Record')).id).customer_id,WALK_IN);
 assert.equal(stored((await mk('Walk-in Customer')).id).customer_id,WALK_IN);
 // ...and the bill is still perfectly readable under its own party name.
 assert.equal(stored((await mk('Nobody Else')).id).party_name,'Nobody Else','an unlinked bill must still show who it was for');

 // ── An explicitly PICKED customer is never re-resolved ──────────────────────
 // Picked from the saved list, so the id decides even where the name is ambiguous.
 const picked=await cust.addCustomer({user_id:'owner',name:'Bilal',phone:'03005556666'});
 assert.equal(stored((await mk('Bilal',{customer_id:picked.id})).id).customer_id,picked.id,
  'a customer chosen by hand was overridden by a name lookup');

 // ── Another account's customer is never linked (own-only writes) ────────────
 await cust.addCustomer({user_id:'staffA',name:'Not Mine Ltd'});
 assert.equal(stored((await mk('Not Mine Ltd')).id).customer_id,WALK_IN,
  'a bill linked to ANOTHER account’s customer record');

 // ── A deleted customer is not a match ───────────────────────────────────────
 const gone=await cust.addCustomer({user_id:'owner',name:'Closed Shop'});
 h.sqlite.prepare('UPDATE customers SET is_deleted = 1 WHERE id = ?').run(gone.id);
 assert.equal(stored((await mk('Closed Shop')).id).customer_id,WALK_IN,'a soft-deleted customer was linked');

 // ── ONE implementation, not two ─────────────────────────────────────────────
 const txnSrc=read('src/services/database/transactionDb.ts');
 const billSrc=read('src/services/database/billDb.ts');
 assert.ok(!/const resolveCustomerId/.test(txnSrc),
  'transactionDb kept its own private copy of the rule — the bill and the khata are free to drift apart again');
 for(const [name,src] of [['transactionDb',txnSrc],['billDb',billSrc]])
  assert.ok(/matchCustomerByName/.test(src),name+' does not go through the shared resolver');
 assert.ok(!/TRIM\(name\) = TRIM\(\?\)/.test(txnSrc)&&!/TRIM\(name\) = TRIM\(\?\)/.test(billSrc),
  'the matching SQL is spelled out a second time outside customerDb');

 // ── EDITING a name RE-LINKS, in both books ──────────────────────────────────
 // Create and edit disagreeing is how this bug class returns, so both are pinned.
 const linkOf=id=>h.one('SELECT customer_id FROM transactions WHERE id = ?',id).customer_id;
 const drifted=await kh.createTransaction('owner','Saara Kloth',4000,'lena','',date);
 assert.equal(linkOf(drifted.id),null,'fixture: the misspelt name must start unlinked');
 await kh.updateTransaction(drifted.id,'owner',{partyName:'Sara Cloth House'});
 assert.equal(linkOf(drifted.id),sara.id,
  'a khata entry corrected ONTO a real customer stayed name-keyed: it never reaches their ledger');
 await kh.updateTransaction(drifted.id,'owner',{partyName:'Someone Else Entirely'});
 assert.equal(linkOf(drifted.id),null,
  'a khata entry renamed AWAY from a customer still claims to be theirs');

 // ...and the derived link is neither editable nor in the visible history.
 await assert.rejects(()=>kh.updateTransaction(drifted.id,'owner',{customer_id:'cust_anything'}),
  /cannot be changed/,'customer_id became a field any caller may set');
 const audited=h.all('SELECT DISTINCT field_name FROM entry_audit WHERE entry_id = ?',drifted.id).map(r=>r.field_name);
 assert.deepEqual(sorted(audited),['partyName'],
  'the derived link was written into the entry’s visible history: a shopkeeper would see an opaque id change, got '+JSON.stringify(audited));

 // The bill edit path, through saveBillEdit.
 const toEdit=await mk('Sara Kloth Hous');
 assert.equal(stored(toEdit.id).customer_id,WALK_IN,'fixture: the misspelt bill must start unlinked');
 const editWith=name=>bills.saveBillEdit(toEdit.id,'owner',
  {customer_id:WALK_IN,party_name:name,bill_date:'2026-09-10',manualTotal:10000,paid:0,lines:[]});
 await editWith('Sara Cloth House');
 assert.equal(stored(toEdit.id).customer_id,sara.id,
  'a bill edited ONTO an existing customer’s name was left as a walk-in');
 await editWith('Nobody At All');
 assert.equal(stored(toEdit.id).customer_id,WALK_IN,
  'a bill renamed AWAY from a customer still points at their record');
 // A hand-picked customer still wins over the name on an edit.
 await bills.saveBillEdit(toEdit.id,'owner',
  {customer_id:picked.id,party_name:'Nobody At All',bill_date:'2026-09-10',manualTotal:10000,paid:0,lines:[]});
 assert.equal(stored(toEdit.id).customer_id,picked.id,'an edit overrode a hand-picked customer with a name lookup');

 // ── The form ASKS before saving a brand-new name ────────────────────────────
 const form=read('src/screens/BillBook/CreateNewBillModal.tsx');
 assert.ok(/confirmIfBrandNewCustomer/.test(form)&&/billNewCustomerBody/.test(form),
  'the bill form saves a brand-new customer name with no confirmation');
 assert.ok(/if \(!\(await confirmIfBrandNewCustomer\(\)\)\) return;[\s\S]{0,200}setLoading\(true\)/.test(form),
  'the confirm must come BEFORE the spinner and the durable attachment copies, so cancelling leaves nothing behind');
 assert.ok(!/'walk_in'/.test(form),'the walk-in sentinel is spelled out in the form as well as the data layer');
}));

check(138,'SUB-STAFF HAVE NO LOGIN, enforced at the door: a legacy account_level row still carries a password hash, so verifyUserLogin refuses it outright rather than trusting that every such row was cleaned up; admins and staff sign in exactly as before',at('src/services/database/userDb.ts','verifyUserLogin'),()=>isolated(async h=>{
 seedPeople(h);h.login('owner');
 const api=h.load('src/services/database/managedAccountDb.ts');
 const udb=users(h);

 // A real staff login, made the only way one can be made.
 const made=await api.createStaffMember({name_en:'Legacy Person',phone:'03105559001',password:'FixturePass1',
  role:'Driver',joining_date:'2026-09-01',area:'Khuzdar',business_type:'Retail'});
 assert.ok(made.user,'fixture: this path must create a login');
 assert.equal((await udb.verifyUserLogin('03105559001','FixturePass1')).id,made.user.id,'fixture: it must log in to begin with');

 // Exactly what a row created BEFORE sub-staff logins were retired looks like: a valid
 // hash, not deleted, account_level = 'substaff'. Nothing can mint one through the API
 // any more, which is why this is written straight to the table.
 h.sqlite.prepare("UPDATE users SET account_level = 'substaff' WHERE id = ?").run(made.user.id);
 assert.equal(await udb.verifyUserLogin('03105559001','FixturePass1'),null,
  'a legacy sub-staff row with a correct password still signed in — the dev wipe is __DEV__ only and manual, so the policy has to hold at login');
 // Refused for being sub-staff, NOT because the row went missing or was soft-deleted.
 const still=h.one('SELECT is_deleted,passwordHash FROM users WHERE id=?',made.user.id);
 assert.equal(still.is_deleted,0,'the refusal must not depend on deleting the row');
 assert.ok(still.passwordHash,'the hash is untouched; only the door is shut');

 // Everyone who is supposed to sign in still does.
 h.sqlite.prepare("UPDATE users SET account_level = 'staff' WHERE id = ?").run(made.user.id);
 assert.equal((await udb.verifyUserLogin('03105559001','FixturePass1')).id,made.user.id,'a staff login was broken by the gate');
 // And a wrong password is still refused for being wrong.
 assert.equal(await udb.verifyUserLogin('03105559001','WrongPass1'),null);

 // The creation path remains closed too, so the gate is a second line and not the only one.
 assert.ok(/Sub-staff no longer have logins/.test(read('src/services/database/accountLevel.ts')),
  'assertConsistentLevel must still refuse to CREATE one');
 assert.ok(/account_level === 'substaff'/.test(read('src/services/database/userDb.ts')),
  'the login gate is gone');
}));

(async()=>{
 const originals=new Map(sourceFiles().map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
 let passed=0;const failures=[];
 for(const t of testCases){try{await t.fn();passed++;console.info('PASS '+String(t.id).padStart(2,'0')+' '+t.name);}catch(e){failures.push(t.id);console.info('FAIL '+String(t.id).padStart(2,'0')+' '+t.name+'\n  '+t.where+'\n  '+e.message.replace(/\n/g,'\n  '));}}
 for(const [p,hash]of originals)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash,'Application source changed during tests: '+p);
 console.info('\nTOTAL '+testCases.length+': '+passed+' PASS, '+failures.length+' FAIL'+(failures.length?' ('+failures.join(', ')+')':''));
 console.info('Temporary databases removed. Application code unchanged. Native PDF rendering/device startup are not simulated.');
 process.exitCode=failures.length?1:0;
})().catch(e=>{console.error('HARNESS ERROR',e);process.exitCode=1;});
