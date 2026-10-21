import { Routes } from '@angular/router';
import { ComparePage } from './pages/compare-page';
import { DemoPage } from './pages/demo-page';
import { GuidePage } from './pages/guide-page';
import { HomePage } from './pages/home-page';
import { SuitePage } from './pages/suite-page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'LangChain & LangGraph Visual Lab' },
  { path: 'start/langchain', component: GuidePage, data: { library: 'langchain' }, title: 'Create a LangChain project' },
  { path: 'start/langgraph', component: GuidePage, data: { library: 'langgraph' }, title: 'Create a LangGraph project' },
  { path: 'compare', component: ComparePage, title: 'LangChain vs LangGraph' },
  { path: 'demo/:id', component: DemoPage, title: 'Demo · Visual Lab' },
  { path: 'suite', component: SuitePage, title: 'Self-test · Visual Lab' },
  { path: '**', redirectTo: '' },
];
