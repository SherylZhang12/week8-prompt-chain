import type {Metadata} from 'next';
import {Theme} from './theme';
import './style.css';

export const metadata:Metadata = {title:'Prompt Chain Lab · Foodfolio',description:'Build, run and inspect ordered AI workflows.'};
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>
    <header className="top"><a href="/" className="brand" aria-label="Foodfolio Prompt Chain Lab">f<span> / prompt chain lab</span></a><div className="top-tools"><Theme/></div></header>
    {children}
  </body></html>;
}
