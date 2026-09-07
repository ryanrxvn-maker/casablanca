'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
export type ToolHeroVideoProps = {src:string;poster?:string;title:string;eyebrow?:string;subtitle?:string;glow?:string};
/** Original demonstration, paired with a compact tool heading. */
export function ToolHeroVideo({src,poster,title,eyebrow,subtitle}:ToolHeroVideoProps) {
 const videoRef=useRef<HTMLVideoElement>(null);
 useEffect(()=>{
   const video=videoRef.current;
   if(!video)return;
   const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
   let visible=false;
   const update=()=>{if(visible&&!reduced.matches&&document.visibilityState==='visible')void video.play().catch(()=>{});else video.pause();};
   const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update();},{threshold:.15});
   observer.observe(video);reduced.addEventListener('change',update);document.addEventListener('visibilitychange',update);
   return()=>{observer.disconnect();reduced.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);video.pause();};
 },[src]);
 return <header className="ae-tool-video-hero"><div><Link href="/tools" className="ae-tool-back">← Todas as ferramentas</Link>{eyebrow&&<p className="ae-tool-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{subtitle&&<p className="ae-tool-subtitle">{subtitle}</p>}</div><video ref={videoRef} src={src} poster={poster} muted loop playsInline preload="metadata" controls aria-label={'Demonstração de '+title}/></header>;
}
