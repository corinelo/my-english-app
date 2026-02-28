import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import { GoogleGenerativeAI } from '@google/generative-ai';

const App = () => {
  const [activeTab, setActiveTab] = useState('learning');
  const [recordingWord, setRecordingWord] = useState(null);
  const [successWord, setSuccessWord] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  
  const [searchInput, setSearchInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [learningData, setLearningData] = useState(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);

  // 🌟 追加：家族のプロフィール設定
  const FAMILY_MEMBERS = ['パパ', 'ママ', '凛ちゃん'];
  const [currentUser, setCurrentUser] = useState(FAMILY_MEMBERS[0]);

  const fetchHistory = async () => {
    try {
      // 🌟 変更：現在選択されているユーザー（currentUser）の履歴だけを取得する
      const { data: sessions, error: sessionsError } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_name', currentUser) // 👈 これがフィルターです！
        .order('created_at', { ascending: false });
      
      if (sessionsError) throw sessionsError;

      // セッションがない場合は空にして終了
      if (!sessions || sessions.length === 0) {
        setHistoryList([]);
        return;
      }

      // 取得したセッションのIDリストを作る
      const sessionIds = sessions.map(s => s.id);

      // 🌟 変更：関連する単語とレビューだけを取得して通信量を節約
      const { data: words, error: wordsError } = await supabase.from('words').select('*').in('session_id', sessionIds);
      if (wordsError) throw wordsError;
      
      const { data: reviews, error: reviewsError } = await supabase.from('reviews').select('*').in('session_id', sessionIds);
      if (reviewsError) throw reviewsError;

      const formattedHistory = sessions.map(session => {
        const sessionWords = words.filter(w => w.session_id === session.id).map(w => w.word);
        const sessionReview = reviews.find(r => r.session_id === session.id);
        let status = 'mastered';
        if (sessionReview) {
          const now = new Date();
          const reviewDate = new Date(sessionReview.next_review_at);
          if (now > reviewDate) status = 'needs_review';
          else status = 'review_soon';
        }
        const dateObj = new Date(session.created_at);
        const dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()} ${dateObj.getHours()}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
        return { id: session.id, date: dateStr, theme: session.theme, words: sessionWords, status: status };
      });
      setHistoryList(formattedHistory);
    } catch (error) {
      console.error("履歴取得エラー:", error);
    }
  };

  // 🌟 追加：ユーザーが切り替わったら、履歴を取り直す
  useEffect(() => {
    fetchHistory();
    setSelectedHistoryIds([]); // 選択状態もリセット
  }, [currentUser]);

  const autoSaveToSupabase = async (data) => {
    try {
      // 🌟 変更：保存する時に「誰のデータか（user_name）」を一緒に保存する
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .insert([{ 
          search_word: data.search_word_jp, 
          theme: data.situation_theme,
          user_name: currentUser // 👈 ここで印をつける！
        }])
        .select();
      
      if (sessionError) throw sessionError;
      const newSessionId = sessionData[0].id; 
      
      const wordsToInsert = data.nuance_group.map((item) => ({
        session_id: newSessionId, word: item.word, nuance_jp: item.nuance_jp, example_en: item.example_en, example_jp: item.example_jp
      }));
      const { error: wordsError } = await supabase.from('words').insert(wordsToInsert);
      if (wordsError) throw wordsError;
      
      const nextReviewDate = new Date();
      nextReviewDate.setDate(nextReviewDate.getDate() + 1);
      const { error: reviewsError } = await supabase.from('reviews').insert([{ session_id: newSessionId, review_level: 1, next_review_at: nextReviewDate.toISOString() }]);
      if (reviewsError) throw reviewsError;

      fetchHistory(); 
    } catch (err) {
      console.error('自動保存エラー:', err);
    }
  };

  const generateNuanceData = async (query = searchInput) => {
    if (!query.trim()) return;
    setSearchInput(query); 
    setIsGenerating(true);
    setLearningData(null); 

    try {
      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `
        あなたは優秀なネイティブ英語教師です。
        ユーザーが入力したキーワード「${query}」について、関連する複数の英単語や表現の微妙なニュアンスの違いを解説してください。
        以下のJSONフォーマットのみを絶対に出力してください。マークダウン（\`\`\`json など）は不要です。
        {
          "search_word_jp": "${query}",
          "situation_theme": "この言葉がよく使われる具体的なシチュエーションを1つ（例: オフィスでの会議）",
          "nuance_group": [
            { "word": "英単語1", "nuance_jp": "ネイティブが感じるニュアンスの違いや使い分けの解説", "example_en": "その単語を使った短い英語の例文", "example_jp": "例文の自然な日本語訳" }
          ],
          "next_related_words": ["関連する日本語のキーワードを3つ"]
        }
      `;
      const result = await model.generateContent(prompt);
      const cleanJsonStr = result.response.text().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const generatedData = JSON.parse(cleanJsonStr);

      setLearningData(generatedData);
      await autoSaveToSupabase(generatedData);

    } catch (error) {
      console.error("AI生成エラー:", error);
      alert("データの生成に失敗しました。");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleSelectHistory = (id) => {
    setSelectedHistoryIds(prev => prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]);
  };

  const deleteSelectedHistory = async () => {
    if (!window.confirm(`${selectedHistoryIds.length}件の履歴を削除しますか？`)) return;
    try {
      await supabase.from('words').delete().in('session_id', selectedHistoryIds);
      await supabase.from('reviews').delete().in('session_id', selectedHistoryIds);
      const { error } = await supabase.from('sessions').delete().in('id', selectedHistoryIds);
      if (error) throw error;
      setSelectedHistoryIds([]); 
      fetchHistory(); 
    } catch (err) {
      console.error('削除エラー:', err);
    }
  };

  const playAudio = (word, example) => {
    if (!window.speechSynthesis) return alert("ブラウザが未対応です。");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${word}. ... ${example}`);
    utterance.lang = 'en-US'; utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const startListening = (targetWord) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("ブラウザが未対応です。");
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onstart = () => setRecordingWord(targetWord);
    recognition.onresult = (event) => {
      const speechResult = event.results[0][0].transcript.toLowerCase();
      if (speechResult.includes(targetWord.toLowerCase())) setSuccessWord(targetWord);
      else alert(`惜しい！ AIには「${speechResult}」と聞こえました。`);
    };
    recognition.onerror = () => setRecordingWord(null); recognition.onend = () => setRecordingWord(null); recognition.start();
  };

  const getStatusBadge = (status) => {
    switch(status) {
      case 'mastered': return <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">定着 ✨</span>;
      case 'review_soon': return <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">そろそろ ⏱️</span>;
      case 'needs_review': return <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold animate-pulse">要復習 ⚠️</span>;
      default: return null;
    }
  };

  const needsReviewCount = historyList.filter(item => item.status === 'needs_review').length;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <header className="bg-white shadow-sm sticky top-0 z-20">
        
        {/* 🌟 追加：ヘッダー上部のプロフィール切り替えエリア */}
        <div className="bg-gray-800 text-white px-4 py-2 flex justify-between items-center text-sm">
          <span className="font-bold opacity-80">🏠 ファミリーアカウント</span>
          <select 
            value={currentUser} 
            onChange={(e) => setCurrentUser(e.target.value)}
            className="bg-gray-700 text-white text-xs font-bold py-1 px-3 rounded-full border-none outline-none cursor-pointer focus:ring-2 focus:ring-blue-400"
          >
            {FAMILY_MEMBERS.map(member => (
              <option key={member} value={member}>{member} の学習室</option>
            ))}
          </select>
        </div>

        <h1 className="text-center text-xl font-extrabold text-gray-800 my-4 tracking-tight">NuanceLingo</h1>
        
        <div className="flex border-b border-gray-200">
          <button onClick={() => setActiveTab('learning')} className={`flex-1 py-3 text-sm font-bold text-center border-b-4 transition-colors ${activeTab === 'learning' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>学習 📚</button>
          <button onClick={() => { setActiveTab('history'); setSelectedHistoryIds([]); }} className={`flex-1 py-3 text-sm font-bold text-center border-b-4 transition-colors ${activeTab === 'history' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>振り返り 🧠 {needsReviewCount > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full ml-1">{needsReviewCount}</span>}</button>
        </div>
      </header>

      {/* （以下、学習タブと履歴タブの中身は変更なし） */}
      {activeTab === 'learning' && (
        <>
          <div className="bg-white p-4 shadow-sm z-10">
            <div className="flex gap-2">
              <input 
                type="text" 
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && generateNuanceData()}
                className="flex-1 w-full bg-gray-100 text-lg rounded-full px-5 py-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="調べたい言葉を入力..."
                disabled={isGenerating}
              />
              <button 
                onClick={() => generateNuanceData()}
                disabled={isGenerating || !searchInput.trim()}
                className="flex-shrink-0 w-12 h-12 bg-blue-500 hover:bg-blue-600 text-white rounded-full flex items-center justify-center shadow-md transition active:scale-95 disabled:opacity-50"
              >
                {isGenerating ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : '🔍'}
              </button>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto p-4 space-y-6 pb-32">
            {isGenerating && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                <p className="animate-pulse">AIが最適なニュアンスを分析中...</p>
              </div>
            )}

            {!isGenerating && !learningData && (
              <div className="text-center text-gray-400 py-20">
                <p className="text-6xl mb-4">💡</p>
                <p>気になる言葉を入力して、<br/>ニュアンスの違いを学びましょう！</p>
              </div>
            )}

            {!isGenerating && learningData && (
              <div className="mb-4 text-sm text-gray-500 font-medium flex items-center justify-center">
                <span className="bg-blue-100 text-blue-700 px-4 py-1.5 rounded-full shadow-sm">📍 {learningData.situation_theme}</span>
              </div>
            )}

            {!isGenerating && learningData && learningData.nuance_group.map((item) => (
              <div key={item.word} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 relative">
                {successWord === item.word && <div className="absolute -top-3 -right-3 bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md transform rotate-12">Nice! 🎉</div>}
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-2xl font-extrabold text-gray-800">{item.word}</h2>
                  <div className="flex space-x-3">
                    <button onClick={() => playAudio(item.word, item.example_en)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition active:scale-95">🔊</button>
                    <button onClick={() => startListening(item.word)} className={`p-2 rounded-full transition ${recordingWord === item.word ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 active:scale-95'}`}>🎤</button>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mb-4 bg-gray-50 p-3 rounded-lg">{item.nuance_jp}</p>
                <div className="border-l-4 border-blue-400 pl-3">
                  <p className="font-medium text-gray-800">{item.example_en}</p>
                  <p className="text-xs text-gray-500 mt-1">{item.example_jp}</p>
                </div>
              </div>
            ))}
          </main>

          {!isGenerating && learningData && (
            <footer className="fixed bottom-0 w-full bg-white border-t border-gray-200 p-4 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)] z-20">
              <p className="text-xs text-gray-500 text-center mb-3 font-medium">👉 次はどのテーマに進む？</p>
              <div className="flex justify-center gap-3">
                {learningData.next_related_words.map((word) => (
                  <button 
                    key={word} 
                    onClick={() => generateNuanceData(word)}
                    className="px-5 py-3 bg-gray-800 text-white text-sm font-bold rounded-full shadow-md hover:bg-gray-700 active:scale-95 transition-transform"
                  >
                    {word}
                  </button>
                ))}
              </div>
            </footer>
          )}
        </>
      )}

      {activeTab === 'history' && (
        <main className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          
          {selectedHistoryIds.length > 0 && (
            <div className="flex justify-between items-center mb-4 bg-red-50 p-3 rounded-xl border border-red-200 shadow-sm sticky top-0 z-10">
              <span className="text-sm text-red-600 font-bold">{selectedHistoryIds.length}件を選択中</span>
              <button 
                onClick={deleteSelectedHistory} 
                className="bg-red-500 text-white text-xs font-bold px-4 py-2 rounded-full hover:bg-red-600 active:scale-95 transition shadow"
              >
                🗑️ 削除する
              </button>
            </div>
          )}

          <h2 className="font-bold text-gray-700 ml-1 mb-2">{currentUser} の学習履歴</h2>
          {historyList.length === 0 ? (
            <p className="text-center text-gray-400 mt-10 text-sm">履歴がありません。<br/>検索すると自動で保存されます！</p>
          ) : (
            historyList.map((session) => (
              <div 
                key={session.id} 
                onClick={() => toggleSelectHistory(session.id)}
                className={`bg-white p-4 rounded-xl shadow-sm border transition cursor-pointer relative ${selectedHistoryIds.includes(session.id) ? 'border-blue-500 ring-2 ring-blue-100 bg-blue-50' : 'border-gray-100 hover:border-gray-300'}`}
              >
                <div className="absolute top-4 right-4">
                  <input 
                    type="checkbox" 
                    checked={selectedHistoryIds.includes(session.id)} 
                    readOnly 
                    className="w-5 h-5 text-blue-600 rounded border-gray-300 pointer-events-none"
                  />
                </div>

                <div className="flex justify-between items-start mb-2 pr-8">
                  <div>
                    <p className="text-xs text-gray-400 font-medium">{session.date}</p>
                    <h3 className="font-bold text-gray-800 mt-1">{session.theme}</h3>
                  </div>
                  {getStatusBadge(session.status)}
                </div>
                
                <div className="flex flex-wrap gap-2 mt-3">
                  {session.words.map(word => (
                    <button 
                      key={word} 
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveTab('learning');
                        generateNuanceData(word);
                      }}
                      className="text-xs bg-gray-50 text-gray-700 font-bold px-3 py-1.5 rounded-md border border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition active:scale-95 shadow-sm"
                    >
                      {word}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </main>
      )}
    </div>
  );
};

export default App;