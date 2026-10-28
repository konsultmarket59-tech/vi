import React from 'react';
import { Icon } from '../core/Icon.jsx';
const labelS={font:'500 13px/1.3 var(--font-body)',color:'var(--text-secondary)'};
const boxS=(f,e)=>({height:40,boxSizing:'border-box',border:`1px solid ${e?'var(--ld-coral)':f?'var(--border-focus)':'var(--border-default)'}`,borderRadius:'var(--radius-sm)',background:'#fff',boxShadow:f?'var(--focus-ring)':'none',transition:'border-color var(--dur-fast), box-shadow var(--dur-fast)'});
export function Select({label,options=[],value,defaultValue,onChange,placeholder,style}){
  const [f,setF]=React.useState(false);
  return <label style={{display:'flex',flexDirection:'column',gap:6,...style}}>
    {label&&<span style={labelS}>{label}</span>}
    <span style={{...boxS(f),position:'relative',display:'flex',alignItems:'center'}}>
      <select value={value} defaultValue={defaultValue} onChange={onChange} onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{appearance:'none',WebkitAppearance:'none',flex:1,height:'100%',border:0,outline:0,background:'transparent',padding:'0 36px 0 12px',font:'400 14px var(--font-body)',color:'var(--text-primary)',cursor:'pointer'}}>
        {placeholder&&<option value="">{placeholder}</option>}
        {options.map(o=>typeof o==='string'?<option key={o}>{o}</option>:<option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevron-down" size={16} color="var(--ld-gray-500)" style={{position:'absolute',right:12,pointerEvents:'none'}}/>
    </span>
  </label>;
}