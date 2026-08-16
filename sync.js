import { SUPABASE_CONFIG } from './supabase-config.js';

const SUPABASE_ESM='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

function configured(){
  return Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey && !SUPABASE_CONFIG.url.includes('YOUR_'));
}

async function fetchAll(queryFactory, pageSize=1000){
  const rows=[];
  for(let from=0;;from+=pageSize){
    const {data,error}=await queryFactory(from,from+pageSize-1);
    if(error) throw error;
    rows.push(...(data||[]));
    if(!data || data.length<pageSize) break;
  }
  return rows;
}

export class SyncManager{
  constructor({getState,rebuildState,onStatus,onAuth}){
    this.getState=getState;
    this.rebuildState=rebuildState;
    this.onStatus=onStatus||(()=>{});
    this.onAuth=onAuth||(()=>{});
    this.client=null;
    this.user=null;
    this.running=null;
    this.timer=null;
  }

  isConfigured(){ return configured(); }
  isSignedIn(){ return Boolean(this.user); }

  async init(){
    if(!configured()){
      this.onStatus({kind:'local',text:'ローカル保存'});
      this.onAuth(null);
      return;
    }
    try{
      this.onStatus({kind:'busy',text:'同期機能を準備中…'});
      const {createClient}=await import(SUPABASE_ESM);
      this.client=createClient(SUPABASE_CONFIG.url,SUPABASE_CONFIG.anonKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
      const {data:{session}}=await this.client.auth.getSession();
      this.user=session?.user||null;
      this.onAuth(this.user);
      this.onStatus({kind:this.user?'online':'local',text:this.user?'同期可能':'未ログイン'});
      this.client.auth.onAuthStateChange((event,session2)=>{
        this.user=session2?.user||null;
        this.onAuth(this.user);
        this.onStatus({kind:this.user?'online':'local',text:this.user?'同期可能':'未ログイン'});
        if(this.user && (event==='SIGNED_IN'||event==='TOKEN_REFRESHED')) setTimeout(()=>this.syncNow().catch(()=>{}),0);
      });
      if(this.user) await this.syncNow();
      window.addEventListener('online',()=>this.scheduleSync(200));
      window.addEventListener('offline',()=>this.onStatus({kind:'offline',text:'オフライン：端末に保存'}));
    }catch(err){
      console.error(err);
      this.onStatus({kind:'error',text:'Supabase接続失敗：ローカル保存で継続'});
    }
  }

  async signIn(email){
    if(!this.client) throw new Error('Supabaseが未設定、または初期化できていません。');
    const redirectTo=location.origin+location.pathname;
    const {error}=await this.client.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo}});
    if(error) throw error;
    this.onStatus({kind:'online',text:'ログインメールを送信しました'});
  }

  async signOut(){
    if(this.client) await this.client.auth.signOut();
    this.user=null;
    this.onAuth(null);
    this.onStatus({kind:'local',text:'ログアウト：ローカル保存'});
  }

  scheduleSync(delay=700){
    if(!this.user || !navigator.onLine) return;
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>this.syncNow().catch(err=>{
      console.error(err);
      this.onStatus({kind:'error',text:'同期失敗：端末には保存済み'});
    }),delay);
  }

  async syncNow(){
    if(!this.client || !this.user || !navigator.onLine) return;
    if(this.running) return this.running;
    this.running=this._sync().finally(()=>{this.running=null});
    return this.running;
  }

  async _sync(){
    this.onStatus({kind:'busy',text:'同期中…'});
    const uid=this.user.id;
    const local=this.getState();

    const remoteAttempts=await fetchAll((from,to)=>
      this.client.from('attempts').select('id,question_id,answered_at,correct,choice,domain,mastery_before,mastery_after').eq('user_id',uid).range(from,to)
    );
    const remoteStates=await fetchAll((from,to)=>
      this.client.from('user_question_state').select('question_id,starred,star_updated_at,updated_at').eq('user_id',uid).range(from,to)
    );

    const mergedMap=new Map();
    for(const a of remoteAttempts) mergedMap.set(a.id,a);
    for(const a of (local.attempts||[])) if(a?.id) mergedMap.set(a.id,a);
    const mergedAttempts=[...mergedMap.values()].sort((a,b)=>new Date(a.answered_at)-new Date(b.answered_at));

    const remoteIds=new Set(remoteAttempts.map(a=>a.id));
    const uploadAttempts=(local.attempts||[]).filter(a=>a?.id && !remoteIds.has(a.id)).map(a=>({...a,user_id:uid}));
    if(uploadAttempts.length){
      const {error}=await this.client.from('attempts').upsert(uploadAttempts,{onConflict:'id'});
      if(error) throw error;
    }

    const starMap={};
    for(const r of remoteStates){
      starMap[r.question_id]={starred:Boolean(r.starred),star_updated_at:r.star_updated_at||r.updated_at||null};
    }
    for(const [qid,p] of Object.entries(local.progress||{})){
      const localTs=p.star_updated_at||null;
      const remote=starMap[qid];
      if(!remote){
        if(p.starred || localTs) starMap[qid]={starred:Boolean(p.starred),star_updated_at:localTs};
        continue;
      }
      if(localTs && (!remote.star_updated_at || new Date(localTs)>new Date(remote.star_updated_at))){
        starMap[qid]={starred:Boolean(p.starred),star_updated_at:localTs};
      }
    }

    const rebuilt=this.rebuildState(mergedAttempts,starMap);
    const snapshots=Object.entries(rebuilt.progress||{}).map(([question_id,p])=>({
      user_id:uid,question_id,starred:Boolean(p.starred),star_updated_at:p.star_updated_at||null,
      attempt_count:p.attempt_count||0,correct_count:p.correct_count||0,wrong_count:p.wrong_count||0,
      correct_streak:p.correct_streak||0,mastery_level:p.mastery_level||0,recovery_count:p.recovery_count||0,
      correct_days:p.correct_days||[],last_answered_at:p.last_answered_at||null,last_wrong_at:p.last_wrong_at||null,
      next_review_at:p.next_review_at||null,updated_at:new Date().toISOString()
    }));
    if(snapshots.length){
      const {error}=await this.client.from('user_question_state').upsert(snapshots,{onConflict:'user_id,question_id'});
      if(error) throw error;
    }

    this.onStatus({kind:'online',text:`同期済み ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`});
  }
}
