import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Button } from '../core/Button.jsx';
import { IconButton } from '../core/IconButton.jsx';
export function Wordmark({src,height=36,inverse=false,onClick}){
  if(src) return <img src={src} alt="Логика Дома" onClick={onClick} style={{height,display:'block',cursor:onClick?'pointer':undefined,filter:inverse?'brightness(0) invert(1)':undefined}}/>;
  return <span onClick={onClick} style={{font:`700 ${Math.round(height*0.42)}px/0.95 var(--font-display)`,letterSpacing:'.06em',color:inverse?'#fff':'var(--ld-navy)',cursor:onClick?'pointer':undefined}}>ЛОГИКА<br/>ДОМА</span>;
}
const DEFAULT_NAV=['Проекты','Подрядчики','Журнал','О сервисе'];
export function Header({logoSrc,nav=DEFAULT_NAV,active,onNavigate,onLogo,ctaLabel='Войти',onCta,variant='desktop',style}){
  if(variant==='mobile') return <header style={{height:56,display:'flex',alignItems:'center',gap:8,padding:'0 8px',background:'#fff',borderBottom:'1px solid var(--border-default)',...style}}>
    <IconButton icon="menu" variant="ghost" label="Меню"/>
    <div style={{flex:1}}><Wordmark src={logoSrc} height={28} onClick={onLogo}/></div>
    <IconButton icon="search" variant="ghost" label="Поиск"/><IconButton icon="user" variant="ghost" label="Профиль"/>
  </header>;
  return <header style={{height:'var(--header-h)',display:'flex',alignItems:'center',gap:40,padding:'0 32px',background:'#fff',borderBottom:'1px solid var(--border-default)',...style}}>
    <Wordmark src={logoSrc} height={38} onClick={onLogo}/>
    <nav style={{display:'flex',gap:28,flex:1}}>{nav.map(n=>{const on=n===active;return <a key={n} href="#" onClick={e=>{e.preventDefault();onNavigate&&onNavigate(n)}} style={{font:`${on?600:500} 14px var(--font-body)`,color:on?'var(--ld-navy)':'var(--text-primary)',padding:'26px 0',borderBottom:on?'2px solid var(--ld-cyan)':'2px solid transparent'}}>{n}</a>})}</nav>
    <div style={{display:'flex',alignItems:'center',gap:8}}><IconButton icon="search" variant="ghost" label="Поиск"/><IconButton icon="heart" variant="ghost" label="Избранное"/><Button size="sm" onClick={onCta}>{ctaLabel}</Button></div>
  </header>;
}