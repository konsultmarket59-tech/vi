import React from 'react';
const fmt=n=>typeof n==='number'?n.toFixed(1).replace('.',','):n;
export function Explication({title='Экспликация помещений',groups=[],total,variant='panel',style}){
  const sum=total??groups.reduce((s,g)=>s+g.rooms.reduce((a,r)=>a+(+r.area||0),0),0);
  const panel=variant==='panel';
  return <div style={{background:'#fff',border:'1px solid var(--border-default)',borderRadius:panel?'var(--radius-md)':0,boxShadow:panel?'var(--shadow-card)':'none',padding:'14px 16px 12px',minWidth:240,boxSizing:'border-box',font:'400 13px/1.3 var(--font-body)',color:'var(--text-primary)',fontVariantNumeric:'tabular-nums',...style}}>
    <div style={{font:'700 15px var(--font-display)',color:'var(--text-heading)',marginBottom:8}}>{title}</div>
    {groups.map((g,gi)=><div key={gi}>
      {g.title&&<div style={{font:'600 11px var(--font-body)',letterSpacing:'.04em',textTransform:'uppercase',color:'var(--text-muted)',margin:gi?'10px 0 4px':'0 0 4px'}}>{g.title}</div>}
      {g.rooms.map(r=><div key={r.n} style={{display:'grid',gridTemplateColumns:'26px 1fr auto',alignItems:'center',gap:8,padding:'4px 0',borderBottom:'1px solid var(--grid-line)'}}>
        <span style={{width:20,height:20,borderRadius:'50%',background:r.wet?'var(--ld-blue-50)':'var(--ld-navy-50)',color:'var(--ld-navy)',font:'600 11px/20px var(--font-display)',textAlign:'center'}}>{r.n}</span>
        <span>{r.name}</span><span style={{fontWeight:500}}>{fmt(r.area)}</span>
      </div>)}
    </div>)}
    <div style={{display:'flex',justifyContent:'space-between',gap:12,whiteSpace:'nowrap',marginTop:8,font:'600 13px var(--font-display)',color:'var(--text-heading)'}}><span>Всего помещений</span><span>{fmt(sum)} м²</span></div>
  </div>;
}