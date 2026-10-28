import React from 'react';
export function RangeSlider({min=0,max=100,step=1,value,defaultValue,onChange,label,unit='',format,style}){
  const [i,setI]=React.useState(defaultValue??[min,max]);const v=value??i;const fmt=format||(n=>n.toLocaleString('ru-RU'));
  const ref=React.useRef(null);
  const pct=n=>((n-min)/(max-min))*100;
  const drag=(idx)=>(e)=>{e.preventDefault();const r=ref.current.getBoundingClientRect();
    const mv=ev=>{let n=min+Math.round(((Math.min(Math.max(ev.clientX-r.left,0),r.width))/r.width)*(max-min)/step)*step;
      const nv=[...v];nv[idx]=idx===0?Math.min(n,v[1]):Math.max(n,v[0]);v[idx]=nv[idx];setI(nv);onChange&&onChange(nv)};
    const up=()=>{window.removeEventListener('pointermove',mv);window.removeEventListener('pointerup',up)};
    window.addEventListener('pointermove',mv);window.addEventListener('pointerup',up)};
  const box={flex:1,height:36,border:'1px solid var(--border-default)',borderRadius:'var(--radius-sm)',display:'flex',alignItems:'center',padding:'0 10px',font:'400 13px var(--font-body)',fontVariantNumeric:'tabular-nums'};
  return <div style={{display:'flex',flexDirection:'column',gap:10,...style}}>
    {label&&<span style={{font:'500 13px var(--font-body)',color:'var(--text-secondary)'}}>{label}</span>}
    <div style={{display:'flex',alignItems:'center',gap:8}}><span style={box}>{fmt(v[0])}{unit&&' '+unit}</span><span style={{width:10,borderTop:'1px solid var(--ld-gray-400)'}}/><span style={box}>{fmt(v[1])}{unit&&' '+unit}</span></div>
    <div ref={ref} style={{position:'relative',height:16,margin:'0 7px'}}>
      <div style={{position:'absolute',top:7,left:0,right:0,height:2,background:'var(--ld-tech-gray)'}}/>
      <div style={{position:'absolute',top:7,height:2,left:pct(v[0])+'%',width:(pct(v[1])-pct(v[0]))+'%',background:'var(--ld-navy)'}}/>
      {[0,1].map(k=><span key={k} onPointerDown={drag(k)} style={{position:'absolute',top:1,left:`calc(${pct(v[k])}% - 7px)`,width:14,height:14,borderRadius:'50%',background:'var(--ld-navy)',boxShadow:'0 0 0 3px #fff, 0 1px 4px rgba(13,26,69,.3)',cursor:'grab',touchAction:'none'}}/>)}
    </div>
  </div>;
}