/** 设置页通用样式（iOS 扁平表单：填充底、无重边框、聚焦蓝色柔光环） */
export const inputClass =
  'w-full rounded-lg border border-transparent bg-ios-fill px-3.5 py-2.5 text-[14px] text-figma-text placeholder:text-ios-label-tertiary focus:border-ios-blue/30 focus:ring-2 focus:ring-ios-blue/20 focus:outline-none dark:bg-ios-fill-dark dark:text-figma-text-dark dark:placeholder:text-ios-label-tertiary-dark dark:focus:border-ios-blue-dark/40 dark:focus:ring-ios-blue-dark/20'
export const selectClass =
  'w-full appearance-none rounded-lg border border-transparent bg-ios-fill px-3.5 py-2.5 text-[14px] text-figma-text focus:border-ios-blue/30 focus:ring-2 focus:ring-ios-blue/20 focus:outline-none dark:bg-ios-fill-dark dark:text-figma-text-dark dark:focus:border-ios-blue-dark/40 dark:focus:ring-ios-blue-dark/20'
export const secondaryBtnClass =
  'rounded-lg bg-ios-fill px-3.5 py-2.5 text-[14px] font-medium text-figma-text transition-colors hover:bg-ios-fill-secondary disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ios-fill-dark dark:text-figma-text-dark dark:hover:bg-ios-fill-secondary-dark'
export const invalidInputClass = `${inputClass} !border-ios-red/60 focus:!border-ios-red focus:!ring-ios-red/20 dark:!border-ios-red-dark/60 dark:focus:!border-ios-red-dark dark:focus:!ring-ios-red-dark/20`
