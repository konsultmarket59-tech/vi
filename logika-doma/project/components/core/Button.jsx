import React from 'react';
import { Icon } from './Icon.jsx';
const SIZES={sm:{h:32,px:14,fs:13},md:{h:40,px:20,fs:14},lg:{h:48,px:28,fs:16}};
export function Button({variant='primary',size='md',icon,iconRight,loading=false,disabled=false,fullWidth=false,children,onClick,style,...rest}){
  const [h,setH]=React.useState(false);const [p,setP]=React.useState(false);
  const s=SIZES[size]||SIZES.md;const off=disabled||loading;
  const v={
    primary:{background:p?'var(--action-primary-press)':h?'var(--action-primary-hover)':'var(--action-primary)',color:'#fff',border:'1px solid transparent'},
    secondary:{background:h?'var(--ld-navy-50)':'#fff',color:'var(--ld-navy)',border:'1px solid var(--ld-navy)'},
    tertiary:{background:'transparent',color:h?'var(--ld-navy)':'var(--ld-blue)',border:'1px solid transparent',paddingLeft:4,paddingRight:4},
  }[variant];
  const dis=disabled?{background:'var(--surface-disabled)',color:'var(--ld-gray-400)',border:'1px solid transparent'}:{};
  const load=loading?{background:'#fff',color:'var(--ld-navy)',border:'1px solid var(--border-strong)'}:{};
  return <button {...rest} disabled={off} onClick={onClick}
    onMouseEnter={()=>setH(true)} onMouseLeave={()=>{setH(false);setP(false)}} onMouseDown={()=>setP(true)} onMouseUp={()=>setP(false)}
    style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,height:s.h,padding:`0 ${s.px}px`,borderRadius:'var(--radius-sm)',font:`600 ${s.fs}px/1 var(--font-body)`,cursor:off?'default':'pointer',transition:'background var(--dur-fast), color var(--dur-fast), transform var(--dur-fast)',transform:p&&!off?'scale(.98)':'none',width:fullWidth?'100%':undefined,whiteSpace:'nowrap',...v,...dis,...load,...style}}>
    {loading&&<span style={{width:14,height:14,borderRadius:'50%',border:'2px solid var(--ld-tech-gray)',borderTopColor:'var(--ld-blue)',animation:'ld-spin .8s linear infinite'}}/>}
    {loading&&<style>{'@keyframes ld-spin{to{transform:rotate(360deg)}}'}</style>}
    {icon&&!loading&&<Icon name={icon} size={s.fs+3}/>}
    {children}
    {iconRight&&<Icon name={iconRight} size={s.fs+3}/>}
  </button>;
}