import React from 'react';
import { Icon } from '../core/Icon.jsx';
const DEF=['Идея','Проект','Настройка','Подрядчик','Дом'];
export function StepPath({steps=DEF,current=0,onSelect,style}){
  return <div style={{display:'flex',alignItems:'flex-start',...style}}>
    {steps.map((s,i)=>{const done=i<current,on=i===current;return <React.Fragment key={i}>
      <div onClick={()=>onSelect&&onSelect(i)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,cursor:onSelect?'pointer':'default',minWidth:64}}>
        <span style={{width:44,height:44,boxSizing:'border-box',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',font:'600 15px var(--font-display)',
          border:`1.5px solid ${on?'var(--ld-cyan)':done?'var(--ld-navy)':'var(--border-strong)'}`,background:done?'var(--ld-navy)':on?'var(--ld-cyan-50)':'#fff',color:done?'#fff':'var(--ld-navy)'}}>{String(i+1).padStart(2,'0')}</span>
        <span style={{font:`${on?600:400} 13px var(--font-body)`,color:on?'var(--ld-navy)':'var(--text-secondary)'}}>{s}</span>
      </div>
      {i<steps.length-1&&<div style={{flex:1,display:'flex',alignItems:'center',height:44,minWidth:24}}><span style={{flex:1,borderTop:`1px solid ${done?'var(--ld-navy)':'var(--ld-gray-400)'}`}}/><Icon name="chevron-right" size={12} color={done?'var(--ld-navy)':'var(--ld-gray-400)'} style={{marginLeft:-6}}/></div>}
    </React.Fragment>})}
  </div>;
}