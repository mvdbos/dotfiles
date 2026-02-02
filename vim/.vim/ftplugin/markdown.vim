" Markdown-specific settings
" Loaded automatically when opening markdown files

" Display settings
setlocal nonumber
setlocal textwidth=0 wrapmargin=0

" Soft wrap settings
setlocal linebreak wrap
setlocal breakindent breakindentopt=shift:2
let &l:showbreak='> '

" Markdown display settings
setlocal conceallevel=2
setlocal foldlevel=3

" Indentation
setlocal ts=4 sw=4 expandtab smarttab

" Completion settings
setlocal complete+=kspell
setlocal infercase

" Format settings (from after/plugin/markdown.vim)
setlocal comments=fb:>,b:*,b:-,b:+
setlocal formatoptions=tron
setlocal formatlistpat=^\\s*\\d\\+[.\\)]\\s\\+\\\|^\\s*[>*+~-]\\s\\+\\\|^\\(\\\|[*#]\\)\\[^[^\\]]\\+\\]:\\s
setlocal autoindent
setlocal nolist
setlocal nolisp
