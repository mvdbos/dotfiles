" Packages/plugins
packadd! dracula

" This should go AFTER set nocompatible to work
set viminfo+=n~/.vim/viminfo

let mapleader = ","

set nowrap
set enc=utf-8
set hidden
set number

set tabstop=4
set softtabstop=4
set expandtab                 " Use spaces instead of tabs for indenting
set copyindent    " copy the previous indentation on autoindentingh
set shiftwidth=4  " number of spaces to use for autoindenting

set cursorline

" search settings
set ignorecase
set smartcase
set gdefault
set hlsearch      " highlight search terms
"This unsets the 'last search pattern' register by hitting return
nnoremap <CR> :noh<CR><CR>o

" Disabling the arrow keys to help do things the 'right' way
nnoremap <up> <nop>
nnoremap <down> <nop>
nnoremap <left> <nop>
nnoremap <right> <nop>
inoremap <up> <nop>
inoremap <down> <nop>
inoremap <left> <nop>
inoremap <right> <nop>
nnoremap j gj
nnoremap k gk

" map jj to Esc
imap jj <Esc>

" Easier moving to start and end of line
nnoremap H ^
nnoremap L $

set backupdir=~/.vim/tmp/backup//
set backup
set undodir=~/.vim/tmp/undo//   " set the undo dir
set undofile                    " enable undo
set directory=~/.vim/tmp/swap//

" Markdown settings
" au BufReadPost,BufNewFile *.md setlocal linebreak wrap
au BufReadPost,BufNewFile *.md setlocal autoindent
au BufReadPost,BufNewFile *.md setlocal breakindent breakindentopt=shift:2
au BufReadPost,BufNewFile *.md setlocal textwidth=0 wrapmargin=0 colorcolumn=
au BufReadPost,BufNewFile *.md setlocal filetype=markdown
au BufReadPost,BufNewFile *.md setlocal conceallevel=2
au BufReadPost,BufNewFile *.md setlocal foldlevel=3
au BufReadPost,BufNewFile *.md setlocal ts=4 sw=4 expandtab smarttab
au BufReadPost,BufNewFile *.md setlocal comments=b:*,b:-,b:+,n:>,se:``` commentstring=>\ %s
au BufReadPost,BufNewFile *.md setlocal formatoptions=tron
au BufReadPost,BufNewFile *.md setlocal formatlistpat=^\\s*\\d\\+\\.\\s\\+\\\\|^\\s*[+-\\*]\\s\\+
au BufReadPost,BufNewFile *.md setlocal nolist
au BufReadPost,BufNewFile *.md setlocal nolisp
au BufReadPost,BufNewFile *.md setlocal spell! spelllang=en_us,nl


" Completion popup settings
set completeopt=menu,longest

" Make <Enter> select item (C-y) instead of inserting new line if menu is open
inoremap <expr> <CR> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"

" Make <Tab> select item (C-y) instead of inserting new line if menu is open
inoremap <expr> <tab> pumvisible() ? "\<C-y>" : "\<tab>"

" Set the height of the completion menu. 0 = all available space
set pumheight=5

" <C-N> work the way it normally does; however, when the menu appears,
" the <Down> key will be simulated. What this accomplishes is it keeps a menu
" item always highlighted. This way you can keep typing characters to narrow
" the matches, and the nearest match will be selected so that you can hit Enter at any time to insert it.
inoremap <expr> <C-n> pumvisible() ? '<C-n>' :
  \ '<C-n><C-r>=pumvisible() ? "\<lt>Down>" : ""<CR>'

colorscheme dracula
highlight Normal ctermbg=None

let g:airline_powerline_fonts = 0
let g:airline#extensions#tabline#enabled = 1
let g:airline#extensions#tabline#tab_nr_type = 1
let g:airline#extensions#tabline#show_buffers = 1
let g:airline#extensions#tabline#buffer_min_count = 0
let g:airline#extensions#tabline#buffer_idx_mode = 1
let g:airline_theme='dracula'
nmap <leader>1 <Plug>AirlineSelectTab1

nmap <leader>2 <Plug>AirlineSelectTab2
nmap <leader>3 <Plug>AirlineSelectTab3
nmap <leader>4 <Plug>AirlineSelectTab4
nmap <leader>5 <Plug>AirlineSelectTab5
nmap <leader>6 <Plug>AirlineSelectTab6
nmap <leader>7 <Plug>AirlineSelectTab7
nmap <leader>8 <Plug>AirlineSelectTab8
nmap <leader>9 <Plug>AirlineSelectTab9

" Vim indent guides settings
let g:indent_guides_guide_size = 1
let g:indent_guides_start_level = 2

" Allow saving of files as sudo when I forgot to start vim using sudo.
cmap w!! %!sudo tee > /dev/null %

" NerdTree settings
map <Leader>n <ESC>:NERDTreeToggle<CR>
let g:NERDTreeShowHidden=0
let NERDTreeMinimalUI=1
let NERDTreeQuitOnOpen=1
let NERDTreeRespectWildIgnore=1

"close vim if the only window left open is a NERDTree
autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTree") && b:NERDTree.isTabTree()) | q | endif

" Shortcuts for split windows
nnoremap <leader>w <C-w>v<C-w>l

nnoremap <C-h> <C-w>h
nnoremap <C-j> <C-w>j
nnoremap <C-k> <C-w>k
nnoremap <C-l> <C-w>l

" Whitespace fixes
highlight ExtraWhitespace ctermbg=red guibg=red
match ExtraWhitespace /\s\+$/
augroup whitespace
    autocmd!
    autocmd BufWinEnter * match ExtraWhitespace /\s\+$/
    autocmd InsertEnter * match ExtraWhitespace /\s\+\%#\@<!$/
    autocmd InsertLeave * match ExtraWhitespace /\s\+$/
    autocmd BufWinLeave * call clearmatches()
augroup END

" Bclose() {{{2
" delete buffer without closing window
" We need this to prevent tagbar closing vim on :bd
cmap bd call Bclose()
function! Bclose()
    let curbufnr = bufnr("%")
    let altbufnr = bufnr("#")

    if buflisted(altbufnr)
        buffer #
    else
        bnext
    endif

    if bufnr("%") == curbufnr
        new
    endif

    if buflisted(curbufnr)
        execute("bdelete! " . curbufnr)
    endif
endfunction

fun! TrimWhitespace()
    let l:save = winsaveview()
    %s/\s\+$//e
    call winrestview(l:save)
endfun

"autocmd FileType c,cpp,python,ruby,java,php,text,vim autocmd BufWritePre * :call TrimWhitespace()
:noremap <Leader>sw :call TrimWhitespace()<CR>


