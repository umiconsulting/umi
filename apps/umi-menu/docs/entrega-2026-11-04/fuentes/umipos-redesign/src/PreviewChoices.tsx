import { Button } from '@/components/base/buttons/button'
import './preview-controls.css'

export function PreviewChoices<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: {value:T;label:string;ariaLabel?:string}[]; onChange:(value:T)=>void
}) {
  return <div className="preview-choices" role="group" aria-label={label}>
    {options.map(option=><Button key={option.value} variant="ghost" aria-label={option.ariaLabel} aria-pressed={value===option.value} onClick={()=>onChange(option.value)}>{option.label}</Button>)}
  </div>
}
