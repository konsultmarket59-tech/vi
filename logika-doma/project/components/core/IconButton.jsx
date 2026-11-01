import React from 'react';
import { Icon } from './Icon.jsx';
export function IconButton({icon,size=40,variant='outline',label,onClick,style,...rest}){
  const [h,setH]=React.useState(false);
  const v=variant==='ghost'?{background:h?'var(--surface-soft)':'transparent',border:'1px solid transparent',color:'var(--ld-graphite)'}:{background:h?'var(--ld-navy-50)':'#fff',border:'1px solid var(--border-default)',color:'var(--ld-navy)'};
  return <button {...rest} aria-label={label} title={label} onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
    style={{width:size,height:size,display:'inline-flex',alignItems:'center',justifyContent:'center',borderRadius:'var(--radius-sm)',cursor:'pointer',padding:0,transition:'background var(--dur-fast)',...v,...style}}>
    <Icon name={icon} size={Math.round(size*0.45)}/>
  </button>;
}