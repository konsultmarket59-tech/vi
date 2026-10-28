import React from 'react';
export function TitleBlock({logoSrc,project,stage='Эскизный проект',sheet,page,pages,date,style}){
  const c={minWidth:0,overflow:'hidden',whiteSpace:'nowrap',borderLeft:'var(--sheet-frame-w) solid var(--sheet-frame)',padding:'6px 10px',display:'flex',flexDirection:'column',justifyContent:'center'};
  const lab={font:'400 9px var(--font-body)',color:'var(--text-muted)'};
  return <div style={{display:'grid',gridTemplateColumns:'64px minmax(0,1fr) 92px',gridTemplateRows:'1fr 1fr',width:440,height:64,border:'var(--sheet-frame-w) solid var(--sheet-frame)',background:'#fff',boxSizing:'border-box',fontVariantNumeric:'tabular-nums',...style}}>
    <div style={{gridColumn:1,gridRow:'1 / 3',display:'flex',alignItems:'center',justifyContent:'center'}}>{logoSrc&&<img src={logoSrc} alt="" style={{height:40}}/>}</div>
    <div style={{...c,gridColumn:2,gridRow:1,borderBottom:'1px solid var(--sheet-frame)'}}><span style={{font:'700 12px var(--font-display)',color:'var(--ld-navy)'}}>{project} · {stage}</span></div>
    <div style={{...c,gridColumn:3,gridRow:'1 / 3',alignItems:'center',gap:2}}><span style={lab}>Лист</span><span style={{font:'600 16px var(--font-display)',color:'var(--text-primary)'}}>{page} / {pages}</span></div>
    <div style={{...c,gridColumn:2,gridRow:2,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><span style={{font:'500 11px var(--font-body)'}}>{sheet}</span>{date&&<span style={lab}>{date}</span>}</div>
  </div>;
}