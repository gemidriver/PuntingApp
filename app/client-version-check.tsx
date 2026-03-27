"use client";
import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "./version";

export default function ClientVersionCheck() {
  const [show, setShow] = useState(false);
  const [latest, setLatest] = useState(APP_VERSION);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    async function checkVersion() {
      try {
        const res = await fetch("/version.json?_=" + Date.now());
        if (!res.ok) return;
        const data = await res.json();
        if (data.version && data.version !== APP_VERSION) {
          setLatest(data.version);
          setShow(true);
        }
      } catch (e) {
        // ignore
      }
    }
    intervalRef.current = setInterval(checkVersion, 30000); // check every 30s
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!show) return null;
  return (
    <div style={{position:'fixed',top:0,left:0,right:0,zIndex:1000,background:'#fffbe6',borderBottom:'1px solid #ffe58f',padding:'16px',textAlign:'center'}}>
      <span style={{color:'#ad6800',fontWeight:600}}>A new version of the app is available.</span>
      <button style={{marginLeft:16,padding:'6px 16px',background:'#ffd666',border:'none',borderRadius:4,cursor:'pointer'}} onClick={()=>window.location.reload()}>Refresh</button>
    </div>
  );
}
