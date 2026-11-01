import React from 'react';
import { Icon } from '../core/Icon.jsx';
export function Rating({value=0,reviews,size=14,showValue=true,style}){
  return <span style={{display:'inline-flex',alignItems:'center',gap:6,font:'600 14px var(--font-body)',color:'var(--text-primary)',...style}}>
    {showValue&&<span>{value.toFixed(1)}</span>}
    <span style={{display:'inline-flex',gap:1}}>{[1,2,3,4,5].map(i=><span key={i} style={{width:size,height:size,background:i<=Math.round(value)?'var(--rating-star)':'var(--ld-tech-gray)',clipPath:'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)'}}/>)}</span>
    {reviews!=null&&<span style={{fontWeight:400,fontSize:12,color:'var(--text-muted)'}}>{reviews} отзывов</span>}
  </span>;
}