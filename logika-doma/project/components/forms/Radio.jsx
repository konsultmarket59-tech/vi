import React from 'react';
export function Radio({options=[],value,defaultValue,onChange,name,direction='row',style}){
  const [i,setI]=React.useState(defaultValue??(options[0]&&(options[0].value??options[0])));const cur=value??i;
  return <div role="radiogroup" style={{display:'flex',flexDirection:direction,gap:direction==='row'?24:10,...style}}>
    {options.map(o=>{const v=o.value??o,l=o.label??o,on=v===cur;
      return <span key={v} role="radio" aria-checked={on} onClick={()=>{setI(v);onChange&&onChange(v)}} style={{display:'inline-flex',alignItems:'center',gap:8,cursor:'pointer',font:'400 14px var(--font-body)',userSelect:'none'}}>
        <span style={{width:18,height:18,boxSizing:'border-box',borderRadius:'50%',border:`1px solid ${on?'var(--ld-navy)':'var(--border-strong)'}`,display:'inline-flex',alignItems:'center',justifyContent:'center',background:'#fff'}}>{on&&<span style={{width:10,height:10,borderRadius:'50%',background:'var(--ld-navy)'}}/>}</span>{l}
      </span>;})}
  </div>;
}