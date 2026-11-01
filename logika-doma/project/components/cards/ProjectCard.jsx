import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Badge } from '../feedback/Badge.jsx';
const BT={'Популярный':'navy','Новинка':'cyan','Акция':'coral','Премиум':'orange'};
export function ProjectCard({image,title,area,rooms,baths,floors,price,badge,favorite=false,onFavorite,onOpen,style}){
  const [h,setH]=React.useState(false);const [fav,setFav]=React.useState(favorite);
  const spec=(ic,t)=>t!=null&&<span style={{display:'inline-flex',alignItems:'center',gap:4}}><Icon name={ic} size={14} color="var(--ld-gray-500)"/>{t}</span>;
  return <article onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} onClick={onOpen}
    style={{background:'var(--surface-card)',border:'1px solid var(--border-default)',borderRadius:'var(--radius-lg)',overflow:'hidden',boxShadow:h?'var(--shadow-hover)':'var(--shadow-card)',transform:h?'translateY(-2px)':'none',transition:'box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)',cursor:onOpen?'pointer':'default',display:'flex',flexDirection:'column',...style}}>
    <div style={{position:'relative',aspectRatio:'4/3',background:'var(--surface-soft)'}}>
      {image&&<img src={image} alt="" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>}
      {badge&&<Badge tone={BT[badge]||'navy'} style={{position:'absolute',top:12,left:12}}>{badge}</Badge>}
      <button onClick={e=>{e.stopPropagation();setFav(!fav);onFavorite&&onFavorite(!fav)}} aria-label="В избранное" style={{position:'absolute',top:10,right:10,width:32,height:32,borderRadius:'50%',border:0,background:'rgba(255,255,255,.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
        <Icon name="heart" size={16} color={fav?'var(--ld-coral)':'var(--ld-graphite)'}/>
      </button>
    </div>
    <div style={{padding:16,display:'flex',flexDirection:'column',gap:10}}>
      <div style={{font:'var(--text-h4)',fontSize:18,color:'var(--text-heading)'}}>{title}</div>
      <div style={{display:'flex',gap:14,flexWrap:'wrap',font:'400 13px var(--font-body)',color:'var(--text-secondary)'}}>{spec('ruler',area!=null?area+' м²':null)}{spec('bed-double',rooms)}{spec('bath',baths)}{spec('layers',floors!=null?floors+' эт.':null)}</div>
      {price!=null&&<div style={{font:'700 20px var(--font-display)',color:'var(--text-primary)',fontVariantNumeric:'tabular-nums'}}><span style={{font:'400 14px var(--font-body)',color:'var(--text-secondary)'}}>от </span>{price.toLocaleString('ru-RU')} ₽</div>}
      <span style={{display:'inline-flex',alignItems:'center',gap:6,font:'600 14px var(--font-body)',color:h?'var(--ld-navy)':'var(--ld-blue)'}}>Подробнее<Icon name="arrow-right" size={16}/></span>
    </div>
  </article>;
}