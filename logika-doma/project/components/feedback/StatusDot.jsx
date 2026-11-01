import React from 'react';
const MAP={draft:['var(--status-draft)','Черновик'],review:['var(--status-review)','На согласовании'],progress:['var(--status-progress)','В работе'],done:['var(--status-done)','Завершён']};
export function StatusDot({status='draft',label,style}){
  const [c,l]=MAP[status]||MAP.draft;
  return <span style={{display:'inline-flex',alignItems:'center',gap:8,font:'400 13px var(--font-body)',color:'var(--text-primary)',...style}}><span style={{width:10,height:10,borderRadius:'50%',background:c,flex:'none'}}/>{label??l}</span>;
}