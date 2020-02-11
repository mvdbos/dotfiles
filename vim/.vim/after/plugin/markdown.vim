au FileType markdown setlocal comments=fb:>,b:*,b:-,b:+
au FileType markdown setlocal formatoptions=tron

au BufReadPost,BufNewFile *.md setlocal formatlistpat=^\\s*\\d\\+[.\)]\\s\\+\\\|^\\s*[>*+~-]\\s\\+\\\|^\\(\\\|[*#]\\)\\[^[^\\]]\\+\\]:\\s 

au BufReadPost,BufNewFile *.md setlocal autoindent
au BufReadPost,BufNewFile *.md setlocal nolist 
au BufReadPost,BufNewFile *.md setlocal nolisp
