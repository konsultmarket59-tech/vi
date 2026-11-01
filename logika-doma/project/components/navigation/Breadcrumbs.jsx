import React from 'react';
import { Icon } from '../core/Icon.jsx';
export function Breadcrumbs({items=[],onNavigate,style}){
  return <nav style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',font:'400 13px var(--font-body)',...style}}>
    {items.map((it,i)=>{const last=i===items.length-1;return <React.Fragment key={i}>
      {last?<span style={{color:'var(--text-primary)'}}>{it}</span>:<a href="#" onClick={e=>{e.preventDefault();onNavigate&&onNavigate(it,i)}} style={{color:'var(--text-muted)'}}>{it}</a>}
      {!last&&<Icon name="chevron-right" size={14} color="var(--ld-gray-400)"/>}
    </React.Fragment>})}
  </nav>;
}