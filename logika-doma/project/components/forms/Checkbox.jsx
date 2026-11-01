import React from 'react';
import { Icon } from '../core/Icon.jsx';
export function Checkbox({label,checked,defaultChecked=false,onChange,disabled,style}){
  const [i,setI]=React.useState(defaultChecked);const on=checked??i;
  const t=()=>{if(disabled)return;setI(!on);onChange&&onChange(!on)};
  return <span onClick={t} role="checkbox" aria-checked={on} style={{display:'inline-flex',alignItems:'center',gap:8,cursor:disabled?'default':'pointer',opacity:disabled?.5:1,font:'400 14px var(--font-body)',color:'var(--text-primary)',userSelect:'none',...style}}>
    <span style={{width:18,height:18,boxSizing:'border-box',borderRadius:4,border:`1px solid ${on?'var(--ld-navy)':'var(--border-strong)'}`,background:on?'var(--ld-navy)':'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',transition:'background var(--dur-fast)'}}>{on&&<Icon name="check" size={13} color="#fff"/>}</span>
    {label}
  </span>;
}