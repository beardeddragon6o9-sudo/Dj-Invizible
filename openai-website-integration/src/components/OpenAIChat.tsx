import React, { useState } from 'react';

const OpenAIChat: React.FC = () => {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<{ user: string; bot: string }[]>([]);

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setInput(event.target.value);
    };

    const handleSendMessage = async () => {
        if (!input) return;

        const userMessage = input;
        setMessages((prevMessages) => [...prevMessages, { user: userMessage, bot: '' }]);
        setInput('');

        // Call OpenAI API here
        const response = await fetch('/api/openai', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: userMessage }),
        });

        const data = await response.json();
        const botMessage = data.response;

        setMessages((prevMessages) => {
            const updatedMessages = [...prevMessages];
            updatedMessages[updatedMessages.length - 1].bot = botMessage;
            return updatedMessages;
        });
    };

    return (
        <div>
            <div className="chat-window">
                {messages.map((msg, index) => (
                    <div key={index}>
                        <div><strong>You:</strong> {msg.user}</div>
                        <div><strong>Bot:</strong> {msg.bot}</div>
                    </div>
                ))}
            </div>
            <input
                type="text"
                value={input}
                onChange={handleInputChange}
                placeholder="Type your message..."
            />
            <button onClick={handleSendMessage}>Send</button>
        </div>
    );
};

export default OpenAIChat;