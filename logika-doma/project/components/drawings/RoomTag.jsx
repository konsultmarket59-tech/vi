import React from 'react';
const fmt=n=>typeof n==='number'?n.toFixed(1).replace('.',','):n;
export function RoomTag({n,name,area,dims,wet=false,scale=1,style}){
  return <div style={{display:'inline-flex',alignItems:'center',gap:6*scale,fontVariantNumeric:'tabular-nums',...style}}>
    <span style={{width:18*scale,height:18*scale,flex:'none',borderRadius:'50%',background:wet?'var(--ld-blue)':'var(--ld-navy)',color:'#fff',font:`600 ${10*scale}px/${18*scale}px var(--font-display)`,textAlign:'center'}}>{n}</span>
    <span style={{display:'flex',flexDirection:'column',lineHeight:1.15}}>
      <span style={{font:`500 ${11*scale}px var(--font-body)`,color:'var(--plan-line)',whiteSpace:'nowrap'}}>{name}</span>
      <span style={{font:`600 ${11*scale}px var(--font-display)`,color:'var(--ld-navy)',whiteSpace:'nowrap'}}>{fmt(area)} м²{dims&&<span style={{font:`400 ${9*scale}px var(--font-body)`,color:'var(--plan-dim)',marginLeft:6*scale}}>{dims}</span>}</span>
    </span>
  </div>;
}