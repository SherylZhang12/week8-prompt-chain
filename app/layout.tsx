import type {Metadata} from 'next';
import {Theme} from './theme';
import './style.css';

export const metadata:Metadata = {title:'Prompt Chain Lab · Foodfolio',description:'Build, run and inspect ordered AI workflows.'};
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>
    <header className="top"><div><strong>Foodfolio</strong><span> / Prompt Chain Lab</span></div><Theme/></header>
    {children}
  </body></html>;
}
