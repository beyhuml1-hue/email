import {DatabaseSync} from 'node:sqlite';
export function createDatabase(path=':memory:'){
  const sql=new DatabaseSync(path);sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const prepare=(query,values=[])=>({bind(...args){return prepare(query,args);},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const result=sql.prepare(query).run(...values);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}});
  return {prepare,batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}},close:()=>sql.close()};
}
