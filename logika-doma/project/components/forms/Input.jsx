import React from 'react';
import { Icon } from '../core/Icon.jsx';
const labelS={font:'500 13px/1.3 var(--font-body)',color:'var(--text-secondary)'};
const boxS=(f,e)=>({height:40,boxSizing:'border-box',border:`1px solid ${e?'var(--ld-coral)':f?'var(--border-focus)':'var(--border-default)'}`,borderRadius:'var(--radius-sm)',background:'#fff',boxShadow:f?'var(--focus-ring)':'none',transition:'border-color var(--dur-fast), box-shadow var(--dur-fast)'});
export function Input({label,placeholder,value,defaultValue,onChange,icon,suffix,error,type='text',style,...rest}){
  const [f,setF]=React.useState(false);
  return <label style={{display:'flex',flexDirection:'column',gap:6,...style}}>
    {label&&<span style={labelS}>{label}</span>}
    <span style={{...boxS(f,error),display:'flex',alignItems:'center',gap:8,padding:'0 12px'}}>
      {icon&&<Icon name={icon} size={16} color="var(--ld-gray-500)"/>}
      <input {...rest} type={type} placeholder={placeholder} value={value} defaultValue={defaultValue} onChange={onChange} onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{flex:1,minWidth:0,border:0,outline:0,background:'transparent',font:'400 14px var(--font-body)',color:'var(--text-primary)'}}/>
      {suffix&&<span style={{font:'400 13px var(--font-body)',color:'var(--text-muted)'}}>{suffix}</span>}
    </span>
    {error&&<span style={{font:'var(--text-caption)',color:'var(--ld-coral)'}}>{error}</span>}
  </label>;
}