import React from 'react';
const TONES={navy:['var(--ld-navy)','#fff'],orange:['var(--ld-orange)','#fff'],cyan:['var(--ld-cyan)','#fff'],coral:['var(--ld-coral)','#fff'],blue:['var(--ld-blue)','#fff'],
  soft:['var(--surface-soft)','var(--text-primary)'],outline:['#fff','var(--text-secondary)']};
export function Badge({tone='navy',children,style}){
  const [bg,fg]=TONES[tone]||TONES.navy;
  return <span style={{display:'inline-flex',alignItems:'center',gap:4,height:22,padding:'0 8px',borderRadius:'var(--radius-xs)',background:bg,color:fg,font:'600 12px/1 var(--font-body)',border:tone==='outline'?'1px solid var(--border-default)':'none',boxSizing:'border-box',whiteSpace:'nowrap',...style}}>{children}</span>;
}