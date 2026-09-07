// Panel entry (issue #215): imports every module in section order, runs the wire functions in
// the legacy statement order, then registers the host message listener and sends the boot posts,
// exactly as the legacy script did at its tail. Body verbatim apart from the S.<name> rewrite.
// The bare imports (format, turns, tiers) are modules this file never calls; they are listed so
// the bundle keeps every module at its legacy section position, which keeps the artifact diffable.
import { vscode } from "./host.js";
import { S } from "./state.js";
import { log, ctxMeter, approvalDock } from "./dom.js";
import { escapeHtml } from "./markdown.js";
import { syncWatermark, renderNotice, renderEngineBanner, copyAction, renderEngineMissing, renderStatus, showLoading, hideLoading, wireShell } from "./shell.js";
import { wireSlash } from "./slash.js";
import { CODEX_UPDATE_CMD, applyModelOptions, setTab, wireEngine } from "./engine.js";
import "./format.js";
import "./turns.js";
import { dismissApproval, renderApproval } from "./approval.js";
import { onMessage } from "./messages.js";
import { renderSessions, wireSessions } from "./sessions.js";
import { hideTyping, syncComposerLock, wireComposer } from "./composer.js";
import { renderStorage, wireStorage } from "./storage.js";
import { panels, showView, wireViews } from "./views.js";
import { pubImageBadge, pubSubmit, pubError, pubReqSel, setPubKind, wirePublish } from "./publish.js";
import { skFd } from "./skeleton.js";
import { feedBodies, feedThreads, renderFeed, renderFeedPost, closeFabCompose, wireFeed } from "./feed.js";
import { quoteCache, quoteInflight, fillQuoteCard } from "./quotes.js";
import "./tiers.js";
import { renderAgents } from "./agents.js";
import { closeRepoRegister, renderRepoModalBody, renderProfile } from "./profile.js";
import { wireMenus } from "./menus.js";
import { setSkills, wireSkills } from "./skills.js";
import { setShopToggle, mktResults, mktDetailBody, openDetail, refreshModalOwned, renderSkillModal, renderSkillDoc, renderComments, refreshDetailOwned, renderDetail, renderMarketResults, ownsMint, wireMarket } from "./market.js";
import { showComplete, renderBalance, buyErrEl, showBuyError, hideBuyError, renderRpcStatus, flashSkill, hideActivity, wireOverlays } from "./overlays.js";
import { setWallet, renderCloudSync, renderWalletStorage, wireWallet } from "./wallet.js";
import { resetPaging, prependOlder, maybeFillOlder, wirePaging } from "./paging.js";

wireShell();
wireSlash();
wireEngine();
wireSessions();
wireComposer();
wireStorage();
wireViews();
wirePublish();
wireFeed();
wireMenus();
wireSkills();
wireMarket();
wireOverlays();
wireWallet();
wirePaging();

window.addEventListener('message', (event) => {
  const m = event.data;
  if (m.type === 'message') onMessage(m.msg);
  else if (m.type === 'sessions') { S.allSessions = m.list || []; S.cloudListState = m.cloud || 'none'; S.activeId = m.activeId; renderSessions(); }
  else if (m.type === 'notice') renderNotice(m.text || '');
  else if (m.type === 'status') renderStatus(m.status || {});
  else if (m.type === 'loading') showLoading();
  else if (m.type === 'clear') { log.innerHTML = ''; approvalDock.innerHTML = ''; ctxMeter.style.display = 'none'; syncComposerLock(); S.streaming = null; S.openBash = null; S.tailTurn = null; S.headTurn = null; hideTyping(); hideActivity(); resetPaging(); syncWatermark(); hideLoading(); }
  else if (m.type === 'turnEnd') { hideTyping(); hideActivity(); }
  else if (m.type === 'modelOptions') { applyModelOptions(m.cli, m.options); }
  else if (m.type === 'usage') {
    // update the context token meter near the composer chips
    const n = m.contextTokens;
    if (typeof n === 'number') {
      const label = n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
      ctxMeter.textContent = 'ctx: ' + label;
      ctxMeter.style.display = 'inline-flex';
    }
  }
  else if (m.type === 'skillActive' && m.origin === 'nft' && m.mint) flashSkill(m.name, m.mint);
  else if (m.type === 'rpcStatus') renderRpcStatus(m.status);
  else if (m.type === 'skillShopping') setShopToggle(m.on);
  else if (m.type === 'searchResults') {
    S.lastMarketResults = m.results || [];
    renderMarketResults(m.results);          // the full Markets view (search lives here now)
  }
  else if (m.type === 'searchError') {
    // don't hang on "Searching…" — show the real reason in the Markets view
    const msg = 'Search failed: ' + escapeHtml(m.message || 'unknown');
    mktResults.innerHTML = '<div class="mktEmpty">' + msg + '</div>';
    // the profile view shares no element with these — clear its loading state too so
    // a failed getAgentProfile doesn't leave the profile stuck on "Loading…".
    if (S.currentProfileWallet) {
      document.getElementById('agentIdCard').innerHTML = '<div class="pr-empty">Could not load profile.</div>';
      document.getElementById('profileBody').innerHTML = '<div class="pr-empty">' + msg + '</div>';
    }
  }
  else if (m.type === 'skillDetail') { if (S.skillModalOpen) renderSkillModal(m.detail); else renderDetail(m.detail); }
  else if (m.type === 'skillDoc') { if (S.skillDocOpen) renderSkillDoc(m.name, m.text); }
  // issue #34: comment write result — re-enable the submit button; on failure show error
  else if (m.type === 'postNoteResult') {
    const submit = mktDetailBody.querySelector('.dt-note-submit') as any; // _reset/_fail expandos set by renderComments
    if (submit) { m.ok ? submit._reset && submit._reset() : submit._fail && submit._fail(m.error || 'Post failed'); }
  }
  // issue #34: refreshed comments pushed after a successful postNote
  else if (m.type === 'notes' && S.currentDetail && m.skillId === S.currentDetail.id) {
    // currentDetail.id is a MINT — gate by mint (the old name-array lookup against a
    // mint always missed, so the comment box vanished on every refresh after a buy).
    const owned = ownsMint(S.currentDetail.id) || S.ownedSkills.indexOf(S.currentDetailName) >= 0;
    renderComments(S.currentDetail.id, S.currentDetail.type, m.notes, owned);
  }
  else if (m.type === 'ownedSkills') {
    S.disposedMints = m.disposedMints || {};         // slug->mint, greyed in the panel
    S.disposedMintSet = new Set(Object.values(S.disposedMints)); // mints, for isDisposed()
    S.workflowMintSet = new Set(m.workflowMints || []); // owned workflows, kept out of the picker
    setSkills(m.names || [], m.mints || {}, m.meta || {});  // refreshes the inventory panel + ownedSkills
    // flip Buy → Owned everywhere the item can appear: market list cards, open detail
    if (panels.market.style.display !== 'none') renderMarketResults(S.lastMarketResults);
    refreshDetailOwned();                    // detail view (if open) — clears its "Buying…"
    refreshModalOwned();                     // skill popup (if open) — flip Buy → Owned
  }
  else if (m.type === 'buyResult') {
    if (m.ok) {
      // COMPLETE plaque; label reflects whether the open detail is a workflow or a skill.
      // (the ownedSkills message that follows flips every Buy button to "Owned".)
      showComplete(S.currentDetail && S.currentDetail.type === 'workflow' ? 'WORKFLOW PURCHASED' : 'SKILL PURCHASED');
      vscode.postMessage({ type: 'getBalance' }); // funds dropped after a buy — refresh
    } else {
      // a failed buy must NOT wipe the catalog: show the reason in a dismissible
      // orange (i) banner and just re-enable the buttons that were mid-"Buying…".
      // On devnet, an insufficient_funds failure offers a "Get devnet SOL" faucet button.
      showBuyError(m.error, m.code === 'insufficient_funds' && S.rpcNetwork !== 'mainnet');
      if (S.detailBuyBtn) { S.detailBuyBtn.disabled = false; S.detailBuyBtn.textContent = 'Buy'; }
      if (S.skillModalBuyBtn) { S.skillModalBuyBtn.disabled = false; S.skillModalBuyBtn.textContent = 'Buy'; }
      renderMarketResults(S.lastMarketResults); // restore any card stuck on "Buying…"
    }
  }
  // devnet faucet result for the "Get devnet SOL" banner button (PR #92 fund flow)
  else if (m.type === 'airdropResult') {
    if (m.ok) {
      renderNotice('Funded. Try the purchase again.');
      vscode.postMessage({ type: 'getBalance' }); // reflect the new balance in the header
      hideBuyError();
    } else {
      renderNotice('Get SOL failed: ' + (m.error || 'unknown'));
      const fb = buyErrEl.querySelector('.buyErrFund') as HTMLButtonElement;
      if (fb) { fb.disabled = false; fb.textContent = 'Get devnet SOL'; }
    }
  }
  // GitHub verified-work registration (issue #93): token status flips the modal form;
  // a register result closes on success (+ refresh) or shows the error inline.
  else if (m.type === 'githubStatus') { renderRepoModalBody(m); }
  else if (m.type === 'workRepoRegistered') {
    if (m.ok) {
      showComplete('GITHUB REGISTERED');
      closeRepoRegister();
      if (S.currentProfileWallet) vscode.postMessage({ type: 'getAgentProfile', wallet: S.currentProfileWallet });
    } else if (S.repoModalEl) {
      const b = S.repoModalEl.querySelector('.rr-body');
      const err = b && b.querySelector('.rr-err');
      const btn = b && b.querySelector('.rr-btn');
      if (err) { err.textContent = m.error || 'Registration failed.'; err.style.display = ''; }
      if (btn) { btn.disabled = false; btn.textContent = 'Register repo'; }
    }
  }
  // dispose / re-equip results: the ownedSkills message that follows updates disposedMints
  // + the panel; re-open the detail (if open) so its button flips Remove<->Re-equip.
  else if (m.type === 'disposeResult') {
    if (m.ok) { if (S.currentDetail) openDetail(S.currentDetail.id); }
    else {
      showBuyError(m.error || 'Unequip failed');
      const rm = mktDetailBody.querySelector('.dt-remove') as HTMLButtonElement;
      if (rm) { rm.disabled = false; rm.textContent = 'Unequip'; }
    }
  }
  else if (m.type === 'reEquipResult') {
    if (m.ok) { if (S.currentDetail) openDetail(S.currentDetail.id); }
    else {
      showBuyError(m.error || 'Re-equip failed');
      if (S.detailBuyBtn) { S.detailBuyBtn.disabled = false; S.detailBuyBtn.textContent = 'Re-equip'; }
    }
  }
  // issue #35: agent directory + profile
  else if (m.type === 'agents') renderAgents(m.agents);
  else if (m.type === 'agentProfile') renderProfile(m.profile);
  // issue #210: the AGENTNET FEED (global blog feed + post reader)
  else if (m.type === 'blogFeed') renderFeed(m.posts);
  else if (m.type === 'blogPost') {
    // authoritative body from the author's own table; null = the mirror row was
    // not backed by a real post (impersonation or a deleted table) — keep the reader
    // on the mirror text rather than blanking it.
    // Disambiguation: reader requests (openFeedPost) never mark quoteInflight,
    // quote-ref requests always do, so wasQuote is exact even when both are out.
    const wasQuote = !!quoteInflight[m.postId];
    if (wasQuote) {
      delete quoteInflight[m.postId];
      // only a real post is cached: a transient null (gateway hiccup) must not
      // pin a permanent deadlink — uncached, the next render pass retries the
      // read; the cards below still show this pass's dead state honestly
      if (m.post) quoteCache[m.postId] = { post: m.post };
    }
    if (m.post) {
      feedBodies[m.postId] = m.post;
      if (S.currentFeedPost && S.currentFeedPost.id === m.postId) renderFeedPost();
    }
    if (wasQuote) {
      // fill any cards still waiting; a renderFeedPost just above rebuilt its
      // own cards straight from quoteCache, so only detached views remain here
      const els = S.quoteCards[m.postId] || [];
      delete S.quoteCards[m.postId];
      els.forEach((el) => fillQuoteCard(el, m.postId, m.post || null));
    }
  }
  else if (m.type === 'blogComments') {
    feedThreads[m.postId] = m.threads || [];
    if (S.currentFeedPost && S.currentFeedPost.id === m.postId) renderFeedPost();
  }
  else if (m.type === 'blogCommentResult') {
    const pane = document.getElementById('agFeedPost') as any; // _mainCompose/_activeCompose expandos set by renderFeedPost
    if (pane && S.currentFeedPost && S.currentFeedPost.id === m.postId) {
      if (m.ok) {
        // success: clear the main composer BEFORE the refreshed thread re-renders
        // (renderFeedPost preserves its half-typed text otherwise), drop any open
        // reply box, and re-read the list fresh so the bump ordering is current.
        if (pane._mainCompose) {
          pane._mainCompose._ta.value = ''; pane._mainCompose._git.value = '';
          pane._mainCompose._btn.disabled = false; pane._mainCompose._btn.textContent = pane._mainCompose._label;
        }
        S.feedReplyTo = null;
        // a sage reply never bumped, so the anchor cache is not stale: a cheap cached
        // read repaints the list without the cold fresh fetch (the dispatcher already
        // re-primes after a bumping reply, so fresh here only covers the repaint)
        vscode.postMessage({ type: 'getBlogFeed', sort: S.feedSort, fresh: !S.feedLastSage });
      } else {
        const box = pane._activeCompose || pane._mainCompose;
        if (box) {
          box._btn.disabled = false; box._btn.textContent = box._label;
          box._err.textContent = m.error || 'Comment failed'; box._err.style.display = '';
        }
      }
    }
  }
  else if (m.type === 'buyAllResult') {
    const confirm = document.getElementById('profileBody') && document.getElementById('profileBody').querySelector('.pr-confirm');
    if (confirm) confirm.remove();
    // Same feedback contract as a single buyResult: a COMPLETE plaque when anything
    // landed, the orange (i) banner when nothing did — without this the whole batch
    // (several signed mainnet txs) finishes with no visible acknowledgement at all.
    if (m.bought > 0) {
      showComplete(m.bought === 1 ? 'SKILL PURCHASED' : m.bought + ' SKILLS PURCHASED');
      vscode.postMessage({ type: 'getBalance' }); // funds dropped after the batch — refresh
      // A partial batch must not swallow its failures: those buys were attempted
      // with real SOL on the line — surface them alongside the success plaque.
      if (m.failed > 0) showBuyError(m.failed + ' of ' + (m.bought + m.failed) + ' purchase(s) failed');
    } else if (!m.ok || m.failed > 0) {
      // Only a REAL failure gets the error banner. A successful no-op (ok:true, bought:0 —
      // e.g. you already own all of this agent's skills) is not a failure; don't alarm.
      showBuyError(m.error || (m.failed > 0 ? m.failed + ' purchase(s) failed' : 'Purchase failed'));
    }
    if (m.ok && S.currentProfileWallet) {
      // refresh profile + owned list so badges update
      vscode.postMessage({ type: 'getAgentProfile', wallet: S.currentProfileWallet });
      vscode.postMessage({ type: 'ownedSkills' });
    }
  }
  else if (m.type === 'agentNoteResult') {
    const body = document.getElementById('profileBody') as any; // _post* expandos set by renderProfile
    const label = (body && body._postLabel) || 'Post';
    if (!m.ok) {
      S.pendingPost = null;
      S.postFeedback = { wallet: m.agentWallet, text: m.error || 'Post failed', ok: false, ts: Date.now() };
      if (body && body._postBtn) {
        body._postBtn.disabled = false; body._postBtn.textContent = label;
        if (body._postErr) { body._postErr.textContent = m.error || 'Post failed'; body._postErr.style.display = ''; body._postErr.classList.remove('ok'); }
      }
      // the feed's FAB compose modal (issue #210): surface the failure in place
      if (S.fabModalEl) {
        S.fabModalEl._btn.disabled = false; S.fabModalEl._btn.textContent = 'Post to AgentNet';
        S.fabModalEl._err.textContent = m.error || 'Post failed'; S.fabModalEl._err.style.display = '';
      }
    } else {
      // a post from the feed's FAB: close the modal and re-read the feed fresh so
      // the new post (mirrored into feed:blog in the same tx) appears on top.
      if (S.fabModalEl) {
        closeFabCompose();
        S.feedPosts = null;
        document.getElementById('feedList').innerHTML = skFd(4);
        vscode.postMessage({ type: 'getBlogFeed', sort: S.feedSort, fresh: true });
      }
      // Success: stash an optimistic note so it shows immediately (the host re-pushes a
      // profile whose on-chain note read lags and won't include it yet), clear the box,
      // and confirm. renderProfile (triggered by the re-push) merges the optimistic note.
      if (S.pendingPost) {
        S.recentlyPosted.push({
          wallet: S.pendingPost.wallet,
          ts: Date.now(),
          // author must be OUR wallet (the writer), not the profile owner's
          // (pendingPost.wallet): mergeOptimistic dedupes the ghost against the real
          // on-chain note by author+text, and the real note's author is the writer —
          // a profile-owner author only matches on self-posts, so comments on OTHER
          // agents rendered twice once the chain read caught up.
          note: { author: S.myWalletAddress || S.pendingPost.wallet, text: S.pendingPost.text, gitLink: S.pendingPost.gitLink, isSelfNote: S.pendingPost.self, parentId: S.pendingPost.parentId, timestamp: Date.now() },
        });
        S.pendingPost = null;
      }
      S.postFeedback = {
        wallet: m.agentWallet,
        text: label === 'Post' ? 'Posted to blog.' : 'Comment posted.',
        ok: true,
        ts: Date.now(),
      };
      showComplete(label === 'Post' ? 'POST PUBLISHED' : 'COMMENT POSTED'); // stays on the profile
      if (body && body._postBtn) {
        body._postBtn.disabled = false; body._postBtn.textContent = label;
        if (body._postTa) body._postTa.value = '';
        if (body._postGit) body._postGit.value = '';
        if (body._postImg) body._postImg.value = '';
        if (body._postTitle) body._postTitle.value = '';
        if (body._postErr) { body._postErr.textContent = label === 'Post' ? 'Posted to blog.' : 'Comment posted.'; body._postErr.style.display = ''; body._postErr.classList.add('ok'); }
      }
    }
  }
  else if (m.type === 'balance') { S.solLamports = m.lamports; renderBalance(); }
  // make-skill: live mint gauge — each wallet signature ticks the submit button label.
  // A local keypair wallet signs silently (no prompts), so this text is the only
  // feedback during the multi-transaction mint; web wallets see it between prompts.
  else if (m.type === 'publishProgress') {
    const phaseLabel = m.phase === 'store' ? 'Storing on-chain' : m.phase === 'mint' ? 'Minting the NFT' : 'Listing for sale';
    pubSubmit.textContent = 'Publishing… ' + (m.total ? m.signed + '/' + m.total + ' signed · ' : '') + phaseLabel;
  }
  // make-skill: publish finished — reset the button, then on success celebrate + go to market
  else if (m.type === 'publishResult') {
    pubSubmit.disabled = false; pubSubmit.textContent = S.pubKind === 'workflow' ? 'Publish workflow' : 'Publish skill';
    if (m.ok) {
      const nm = (document.getElementById('pubName') as HTMLInputElement).value.trim();
      ['pubName','pubDesc','pubCategory','pubHashtags','pubImage','pubText'].forEach(id => { (document.getElementById(id) as HTMLInputElement).value = ''; });
      (document.getElementById('pubPrice') as HTMLInputElement).value = '0.1';
      pubImageBadge.style.display = 'none';
      for (const k in pubReqSel) delete pubReqSel[k]; // clear the workflow picker
      const wasWorkflow = S.pubKind === 'workflow';
      setPubKind('skill');
      showComplete(wasWorkflow ? 'WORKFLOW BUILT' : 'SKILL CREATED');
      showView('market'); // see it listed (it's owned by you now)
    } else {
      pubError.textContent = m.error || 'Publish failed.'; pubError.style.display = 'block';
    }
  }
  else if (m.type === 'platform') setTab(m.cli); // extension switched CLI (e.g. on session open)
  else if (m.type === 'cliStatus') {
    S.cliReport = { claude: m.claude, codex: m.codex };
    const status = S.cliReport[S.cli];
    if (status === 'no-login') renderNotice((S.cli === 'claude' ? 'Claude' : 'Codex') + ' is not signed in. Type /login to connect it.');
    else if (status === 'missing') renderEngineMissing(S.cli);
  }
  else if (m.type === 'engineUpdate' && m.cli === 'codex') {
    // Host-side codex probe saw the stale-models-cache signal: the installed codex is
    // too old to read the server's model list, so new models exist but stay hidden.
    // A persistent, dismissible banner (not a log notice that a repaint would wipe).
    renderEngineBanner(
      'Codex is out of date, so new models are hidden. Update it, then reload this window.',
      [
        ['Update in terminal', () => vscode.postMessage({ type: 'installEngine', cli: 'codex', update: true })],
        copyAction(CODEX_UPDATE_CMD),
      ],
      'codex'
    );
  }
  else if (m.type === 'claudeLoginUrl') {
    renderNotice('Claude sign-in opened. If the browser did not open, visit:\n' + m.url + '\nAfter approving, paste the returned code with /login <code>.');
  }
  else if (m.type === 'claudeLoginStatus') {
    if (m.status === 'done') {
      S.cliReport = Object.assign({}, S.cliReport || {}, { claude: 'ok' });
      renderNotice('Claude sign-in complete.');
      if (S.cli === 'claude') vscode.postMessage({ type: 'platform', cli: 'claude' });
    } else {
      renderNotice('Claude sign-in failed: ' + (m.error || 'Login was not completed.'));
    }
  }
  else if (m.type === 'codexLoginChallenge') {
    renderNotice('Codex sign-in opened. If the browser did not open, visit:\n' + m.url + '\nEnter this one-time code on the page: ' + m.code);
  }
  else if (m.type === 'codexLoginStatus') {
    if (m.status === 'done') {
      S.cliReport = Object.assign({}, S.cliReport || {}, { codex: 'ok' });
      renderNotice('Codex sign-in complete.');
      if (S.cli === 'codex') vscode.postMessage({ type: 'platform', cli: 'codex' });
    } else {
      renderNotice('Codex sign-in failed: ' + (m.error || 'Login was not completed.'));
    }
  }
  else if (m.type === 'toast') renderNotice(m.text || '');
  else if (m.type === 'openUrl' && m.url) window.open(m.url, '_blank', 'noopener,noreferrer');
  else if (m.type === 'storage') { renderStorage(m.info, m.options); renderWalletStorage(); }
  else if (m.type === 'cloudSync') renderCloudSync(m.status);
  else if (m.type === 'wallet') setWallet(m.address);
  else if (m.type === 'page') { hideLoading(); S.hasMore = m.hasMore; S.pageCursor = m.cursor; maybeFillOlder(); }
  else if (m.type === 'older') {
    prependOlder(m.messages || []);
    S.hasMore = m.hasMore; S.pageCursor = m.cursor; S.loadingOlder = false;
    maybeFillOlder();
  }
  else if (m.type === 'approval') renderApproval(m.req);
  else if (m.type === 'approvalDismiss') dismissApproval(m.id);
});

vscode.postMessage({ type: 'ready' });
vscode.postMessage({ type: 'wallet' }); // fill the bottom-left wallet card on load
vscode.postMessage({ type: 'getBalance' }); // and prime the SOL balance display
