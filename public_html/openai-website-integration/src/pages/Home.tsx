import React from 'react';
import OpenAIChat from '../components/OpenAIChat';

const Home: React.FC = () => {
    return (
        <div>
            <h1>Welcome to the OpenAI Chat Integration</h1>
            <OpenAIChat />
        </div>
    );
};

export default Home;