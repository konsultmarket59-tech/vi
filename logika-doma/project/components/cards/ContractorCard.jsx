import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Button } from '../core/Button.jsx';
import { Rating } from '../feedback/Rating.jsx';
export function ContractorCard({name,role,avatar,rating,reviews,location,experience,verified=false,contract=false,primaryLabel='Связаться',secondaryLabel,onPrimary,onSecondary,style}){
  return <article style={{background:'var(--surface-card)',border:'1px solid var(--border-default)',borderRadius:'var(--radius-lg)',boxShadow:'var(--shadow-card)',padding:20,display:'flex',flexDirection:'column',gap:14,...style}}>
    <div style={{display:'flex',gap:14,alignItems:'center'}}>
      <div style={{width:56,height:56,borderRadius:'50%',overflow:'hidden',flex:'none',background:'var(--ld-navy-50)',display:'flex',alignItems:'center',justifyContent:'center'}}>
        {avatar?<img src={avatar} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{font:'700 20px var(--font-display)',color:'var(--ld-navy)'}}>{(name||'?').split(' ').map(w=>w[0]).slice(0,2).join('')}</span>}
      </div>
      <div style={{minWidth:0}}><div style={{font:'600 17px var(--font-display)',color:'var(--text-heading)'}}>{name}</div>{role&&<div style={{font:'400 13px/1.35 var(--font-body)',color:'var(--text-secondary)'}}>{role}</div>}</div>
    </div>
    {rating!=null&&<Rating value={rating} reviews={reviews}/>}
    <div style={{display:'flex',flexDirection:'column',gap:6,font:'400 13px var(--font-body)',color:'var(--text-secondary)'}}>
      {location&&<span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="map-pin" size={14}/>{location}</span>}
      {experience&&<span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="briefcase" size={14}/>Опыт {experience}</span>}
    </div>
    {(verified||contract)&&<div style={{display:'flex',gap:12,font:'500 12px var(--font-body)'}}>
      {verified&&<span style={{display:'inline-flex',alignItems:'center',gap:4,color:'var(--ld-cyan)'}}><Icon name="badge-check" size={14}/>Проверен</span>}
      {contract&&<span style={{display:'inline-flex',alignItems:'center',gap:4,color:'var(--text-secondary)'}}><Icon name="file-check" size={14}/>Договор</span>}
    </div>}
    <div style={{display:'flex',gap:8,marginTop:'auto'}}>
      {primaryLabel&&<Button fullWidth iconRight="arrow-right" onClick={onPrimary}>{primaryLabel}</Button>}
      {secondaryLabel&&<Button fullWidth variant="secondary" onClick={onSecondary}>{secondaryLabel}</Button>}
    </div>
  </article>;
}