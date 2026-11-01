import React from 'react';
const BASE='https://unpkg.com/lucide-static@0.460.0/icons/';
export function Icon({name,size=20,color='currentColor',style,...rest}){
  const m=`url(${BASE}${name}.svg) center/contain no-repeat`;
  return <span aria-hidden="true" {...rest} style={{display:'inline-block',flex:'none',width:size,height:size,background:color,WebkitMask:m,mask:m,...style}}/>;
}