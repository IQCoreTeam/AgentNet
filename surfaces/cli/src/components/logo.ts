// The Iggy mascot — our real brand mark (media/iq-logo.svg) rendered to terminal ASCII
// via chafa (`chafa -f symbols --symbols ascii+space --fg-only --invert`). The SVG is a
// bezier vector that can't draw in a terminal, so this is the baked-in art. Shown at a
// large size during boot (Banner); the settled welcome panel uses the compact "IQ" wordmark.
export const MASCOT = [
  "        _*=~~~=*ay_                  _yg*=~~~=*_",
  "       a'        `~=@g_          _a0P~`        `g",
  "       [             `~Rg_    _gP~`             1",
  "       l           ______3@gg@E______           j",
  "       1  ___agg@PP4@P~EE@@@R@@F~=@=4@R@ggy___  /",
  "      _ygP=~~~`  _*=*GCg@@@-yaP@@ga? aZg_``~~=4gy_",
  "   ysF~``,     _F~y==g@@F~  ~ ~~4@gra,`y_*     '`~?ay",
  " yP~     `   gg@@@@@@@@@@g@@@@@@@@@@@ggyL\\4,  '     ~4y",
  "a'         . A@__       _@L_          `~~@$9 `        's",
  "$           g ~9@P```   @@@~```  _@@,     t@,          4",
  "\"L          %aa@@      z@aF      @ @'     j@$         _~",
  " `=.        y@@@F      @'\"@      4P~     _$@[       ,f`",
  "    \"= _    @@M@      gF, 7@g_        .yg@5@%   _  ~",
  "          -@@@@@@@@@@RR tw^ \"@4@gy___   _gP$@s `",
  "         _@~ ~@_==4?e=ggggZgE_-y4C~~=4R@@@*' #g",
  "        _$     ~=aEE__~G@4P~~=@g__gg@@g@F'    9L",
  "        @          ````FFF      `~~~~~`        0,",
  "       0'                                      `@",
  "       $                                        9",
  "       %                                        1",
  "       t,          ,-            ` -.          _P",
  "        ~=w__,-*=^`                  `  - .__w*~",
];
