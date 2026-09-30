// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HighlightContext } from './AttemptHighlights';
import { HostedBlocks, HostedChoices } from './HostedPresentation';
afterEach(cleanup);
it('captures selected text offsets and renders saved highlights on reload', () => {
  const add=vi.fn();
  const content=<HostedBlocks revisionId="r" questionId="q" blocks={[{kind:'text',text:'Choose the correct word.'}]} />;
  const view=render(<HighlightContext.Provider value={{enabled:true,highlights:[],add}}>{content}</HighlightContext.Provider>);
  const element=screen.getByText('Choose the correct word.');
  const range=document.createRange(); range.setStart(element.firstChild!,7); range.setEnd(element.firstChild!,10);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent.pointerUp(element);
  expect(add).toHaveBeenCalledWith({block:'stem:0',kind:'text',start:7,end:10});
  view.rerender(<HighlightContext.Provider value={{enabled:false,highlights:[{block:'stem:0',kind:'text',start:7,end:10}],add}}>{content}</HighlightContext.Provider>);
  expect(document.querySelector('mark')?.textContent).toBe('the');
});
it('does not answer while highlighting a choice', () => {
  const onSelect=vi.fn();
  render(<HighlightContext.Provider value={{enabled:true,highlights:[],add:()=>{}}}><HostedChoices revisionId="r" questionId="q" eliminated={[]} onSelect={onSelect} onEliminate={()=>{}}
    presentation={{version:3,stimulus:[],stem:[],choices:[{id:'A',content:[{kind:'text',text:'Answer text'}]}]}} /></HighlightContext.Provider>);
  fireEvent.click(screen.getByRole('radio'));
  expect(onSelect).not.toHaveBeenCalled();
});
it('allows keyboard image highlighting and restores normalized regions', () => {
  const add=vi.fn();
  render(<HighlightContext.Provider value={{enabled:true,highlights:[{block:'stem:0',kind:'region',x:.2,y:.3,width:.4,height:.1}],add}}><HostedBlocks revisionId="r" questionId="q" blocks={[{kind:'image_asset',assetId:'image',alt:'Question',width:2000,height:500}]} /></HighlightContext.Provider>);
  fireEvent.keyDown(screen.getByLabelText(/Highlight image region/),{key:'Enter'});
  expect(add).toHaveBeenCalledWith({block:'stem:0',kind:'region',x:0,y:0,width:1,height:1});
  expect((document.querySelector('.attempt-highlight-region') as HTMLElement).style.left).toBe('20%');
});
